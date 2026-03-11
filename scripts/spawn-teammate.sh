#!/usr/bin/env bash
# Usage: spawn-teammate.sh <team_id> <agent_id> <task_description> [model]
# Spawns a teammate in a tmux pane. Uses git worktrees for file isolation when
# running inside a git repository; falls back to working in the current directory.

set -euo pipefail

TEAM_ID="$1"
AGENT_ID="$2"
TASK_DESC="$3"
MODEL="${4:-${TEAMMATE_MODEL:-claude-sonnet-4-6}}"

PROMPT="You are $AGENT_ID on team $TEAM_ID. Register with register_teammate, then list_tasks, claim your work, and complete it. Task context: $TASK_DESC"

# Check if we're inside a git repository
is_git_repo() {
  git rev-parse --is-inside-work-tree &>/dev/null
}

# Detect tmux even when $TMUX env var is stripped (e.g. by Copilot Chat).
#
# The process-tree walk approach fails when the calling process (e.g. Copilot's
# language server) is a daemon whose parent chain goes straight to PID 1 (launchd)
# — tmux is a sibling process, not an ancestor.
#
# Instead, ask the tmux server directly via its Unix socket. This works from any
# process on the same machine regardless of env vars or process ancestry.
can_use_tmux() {
  # Fast path: env var present means we're definitely in tmux
  [ -n "${TMUX:-}" ] && return 0
  # Ask the tmux server if any sessions exist with attached clients.
  # "tmux list-clients" connects via the socket (/tmp/tmux-UID/default) and
  # succeeds even without $TMUX set. We require at least one attached client
  # so we don't blindly split-window into a detached/invisible session.
  tmux list-clients -F '#{client_session}' 2>/dev/null | grep -q .
}

if command -v tmux &>/dev/null && can_use_tmux; then
  WORK_DIR="$(pwd)"
  WORKTREE_INFO=""

  # Use git worktrees for file isolation when available
  if is_git_repo; then
    WORKTREE_DIR=".copilot-teams/worktrees/${TEAM_ID}/${AGENT_ID}"
    BRANCH_NAME="team/${TEAM_ID}/${AGENT_ID}"
    if [ ! -d "$WORKTREE_DIR" ]; then
      mkdir -p "$(dirname "$WORKTREE_DIR")"
      if git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" 2>/dev/null || \
         git worktree add "$WORKTREE_DIR" "$BRANCH_NAME" 2>/dev/null; then
        WORK_DIR="$(cd "$WORKTREE_DIR" && pwd)"
        WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
      else
        echo "WARNING: worktree creation failed — teammates will share the working directory" >&2
      fi
    else
      WORK_DIR="$(cd "$WORKTREE_DIR" && pwd)"
      WORKTREE_INFO=" with worktree (branch: $BRANCH_NAME)"
    fi
  fi

  # Write the prompt to a temp file so it can be safely read by tmux send-keys
  # without quoting issues from special chars in task descriptions.
  # The outer shell owns this file; cleanup via trap on exit.
  PROMPT_FILE="$(mktemp)"
  trap 'rm -f "$PROMPT_FILE"' EXIT
  printf '%s\n' "$PROMPT" > "$PROMPT_FILE"

  # Use a login shell (-l) so PATH includes tools installed via nvm, npm global,
  # homebrew, etc. that are set up in ~/.bashrc / ~/.zshrc. Without -l, "copilot"
  # may not be found — causing the pane to flash and close instantly.
  #
  # We start copilot interactively (no -p flag) with --yolo so it auto-approves
  # tool calls without confirmation prompts. The initial prompt is injected
  # afterward via tmux send-keys, keeping the session fully interactive — the
  # teammate runs its multi-step agent loop and the user can observe or intervene.
  #
  # The trailing echo+read keeps the pane open after copilot exits (whether
  # normally, by crash, or if the binary isn't found) so the user can review
  # output before the pane closes.
  SHELL_CMD="${SHELL:-/bin/bash}"
  PANE_ID=$(tmux split-window -h -c "$WORK_DIR" -P -F '#{pane_id}' \
    "$SHELL_CMD -lc 'copilot --agent=copilot-agent-teams/teammate --model \"$MODEL\" --yolo; echo \"[pane exited — press any key to close]\"; read -n1'") || {
    echo "ERROR: failed to create tmux pane for $AGENT_ID" >&2
    exit 1
  }

  # Wait for copilot to show its input prompt before injecting the task.
  # Polls pane content instead of a fixed sleep to handle slow shell init,
  # nvm loading, etc. without unnecessary delay on fast systems.
  MAX_WAIT=30
  for i in $(seq 1 $MAX_WAIT); do
    if tmux capture-pane -t "$PANE_ID" -p 2>/dev/null | grep -q '>'; then
      break
    fi
    if [ "$i" -eq "$MAX_WAIT" ]; then
      echo "ERROR: copilot did not start within ${MAX_WAIT}s in pane for $AGENT_ID" >&2
      exit 1
    fi
    sleep 1
  done

  # Send the prompt as literal text (-l) to avoid tmux interpreting substrings
  # like "Enter", "Escape", "Tab", "C-c" as key names. Enter is sent separately.
  PROMPT_TEXT="$(cat "$PROMPT_FILE")" || {
    echo "ERROR: prompt file was deleted before it could be read (pane likely crashed)" >&2
    exit 1
  }
  tmux send-keys -t "$PANE_ID" -l "$PROMPT_TEXT"
  tmux send-keys -t "$PANE_ID" Enter

  tmux select-layout tiled 2>/dev/null || true
  echo "WORK_DIR=$WORK_DIR"
  echo "Spawned $AGENT_ID in tmux pane${WORKTREE_INFO} (model: $MODEL)"
else
  echo "NOT_IN_TMUX"
fi
