#!/usr/bin/env bash
# Usage: spawn-teammate.sh <team_id> <agent_id> <task_description> [model]
# Spawns a teammate in a tmux pane if available, outputs NOT_IN_TMUX otherwise.

set -euo pipefail

TEAM_ID="$1"
AGENT_ID="$2"
TASK_DESC="$3"
MODEL="${4:-${TEAMMATE_MODEL:-claude-sonnet-4-6}}"

PROMPT="You are $AGENT_ID on team $TEAM_ID. Register with register_teammate, then list_tasks, claim your work, and complete it. Task context: $TASK_DESC"

if command -v tmux &>/dev/null && [ -n "${TMUX:-}" ]; then
  tmux split-window -h -- copilot -a teammate -m "$MODEL" "$PROMPT"
  tmux select-layout tiled
  echo "Spawned $AGENT_ID in tmux pane (model: $MODEL)"
else
  echo "NOT_IN_TMUX"
fi
