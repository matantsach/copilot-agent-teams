#!/usr/bin/env bash
# Usage: cleanup-worktrees.sh [team_id]
# Removes git worktrees created for teammates. If team_id given, only those worktrees.

set -euo pipefail

WORKTREE_BASE=".copilot-teams/worktrees"

if [ ! -d "$WORKTREE_BASE" ]; then
  echo "No worktrees to clean up"
  exit 0
fi

cleaned=0
for worktree in "$WORKTREE_BASE"/*/; do
  [ -d "$worktree" ] || continue
  agent_id=$(basename "$worktree")

  # If team_id filter provided, check branch name
  if [ -n "${1:-}" ]; then
    branch=$(git -C "$worktree" branch --show-current 2>/dev/null || true)
    if [[ "$branch" != "team/$1/"* ]]; then
      continue
    fi
  fi

  git worktree remove "$worktree" --force 2>/dev/null || true

  # Clean up the branch too
  if [ -n "${1:-}" ]; then
    git branch -D "team/$1/$agent_id" 2>/dev/null || true
  fi

  cleaned=$((cleaned + 1))
done

# Prune any stale worktree references
git worktree prune 2>/dev/null || true

echo "Cleaned up $cleaned worktree(s)"
