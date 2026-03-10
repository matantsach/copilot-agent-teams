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

# Detect tmux even when $TMUX env var is stripped (e.g. by Copilot Chat)
in_tmux() {
  [ -n "${TMUX:-}" ] && return 0
  # Walk up process tree looking for tmux as an ancestor
  local pid=$$
  while [ "$pid" -gt 1 ] 2>/dev/null; do
    local cmd
    cmd=$(ps -o comm= -p "$pid" 2>/dev/null) || break
    case "$cmd" in tmux*) return 0 ;; esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || break
  done
  return 1
}

if command -v tmux &>/dev/null && in_tmux; then
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
