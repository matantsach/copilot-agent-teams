#!/usr/bin/env bash
# Usage: spawn-teammate.sh <team_id> <agent_id> <task_description> [model]
# Spawns a teammate in a tmux pane with its own git worktree for file isolation.

set -euo pipefail

TEAM_ID="$1"
AGENT_ID="$2"
TASK_DESC="$3"
MODEL="${4:-${TEAMMATE_MODEL:-claude-sonnet-4-6}}"

# Create git worktree for isolation (keyed by team+agent to avoid cross-team collision)
WORKTREE_DIR=".copilot-teams/worktrees/${TEAM_ID}/${AGENT_ID}"
BRANCH_NAME="team/${TEAM_ID}/${AGENT_ID}"

PROMPT="You are $AGENT_ID on team $TEAM_ID. Register with register_teammate, then list_tasks, claim your work, and complete it. Task context: $TASK_DESC"

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
  if [ ! -d "$WORKTREE_DIR" ]; then
    mkdir -p "$(dirname "$WORKTREE_DIR")"
    git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" 2>/dev/null || \
      git worktree add "$WORKTREE_DIR" "$BRANCH_NAME" 2>/dev/null || \
      { echo "WORKTREE_FAILED"; exit 1; }
  fi

  TEAMMATE_PROMPT="$PROMPT" tmux split-window -h -c "$WORKTREE_DIR" -e "TEAMMATE_PROMPT=$PROMPT" \
    "copilot -a teammate -m '$MODEL' \"\$TEAMMATE_PROMPT\""
  tmux select-layout tiled
  echo "WORKTREE_PATH=$WORKTREE_DIR"
  echo "Spawned $AGENT_ID in tmux pane with worktree (model: $MODEL, branch: $BRANCH_NAME)"
else
  echo "NOT_IN_TMUX"
fi
