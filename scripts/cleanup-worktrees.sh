#!/usr/bin/env bash
# Usage: cleanup-worktrees.sh [team_id] [--force]
# Removes git worktrees created for teammates. If team_id given, only those worktrees.
# Without --force, skips worktrees with uncommitted changes.
# Safe to run in non-git repos (exits cleanly if no worktrees exist).

set -euo pipefail

WORKTREE_BASE=".copilot-teams/worktrees"
FORCE=false

for arg in "$@"; do
  if [ "$arg" = "--force" ]; then
    FORCE=true
  fi
done

TEAM_FILTER="${1:-}"
if [ "$TEAM_FILTER" = "--force" ]; then
  TEAM_FILTER=""
fi

if [ ! -d "$WORKTREE_BASE" ]; then
  echo "No worktrees to clean up"
  exit 0
fi

is_git_repo() {
  git rev-parse --is-inside-work-tree &>/dev/null
}

cleaned=0
skipped=0

# Iterate worktrees — structure is worktrees/<team_id>/<agent_id>
for team_dir in "$WORKTREE_BASE"/*/; do
  [ -d "$team_dir" ] || continue
  team_id=$(basename "$team_dir")

  # Filter by team_id if provided
  if [ -n "$TEAM_FILTER" ] && [ "$team_id" != "$TEAM_FILTER" ]; then
    continue
  fi

  for worktree in "$team_dir"*/; do
    [ -d "$worktree" ] || continue
    agent_id=$(basename "$worktree")

    if is_git_repo; then
      # Check for uncommitted changes
      if [ "$FORCE" = false ]; then
        if ! git -C "$worktree" diff --quiet 2>/dev/null || ! git -C "$worktree" diff --cached --quiet 2>/dev/null; then
          echo "WARNING: $agent_id (team $team_id) has uncommitted changes — skipping (use --force to override)"
          skipped=$((skipped + 1))
          continue
        fi
      fi

      git worktree remove "$worktree" --force 2>/dev/null || true
      git branch -D "team/$team_id/$agent_id" 2>/dev/null || true
    else
      # Non-git repo: just remove the directory
      rm -rf "$worktree"
    fi
    cleaned=$((cleaned + 1))
  done

  # Remove empty team directory
  rmdir "$team_dir" 2>/dev/null || true
done

# Prune any stale worktree references (only in git repos)
if is_git_repo; then
  git worktree prune 2>/dev/null || true
fi

echo "Cleaned up $cleaned worktree(s)"
if [ "$skipped" -gt 0 ]; then
  echo "Skipped $skipped worktree(s) with uncommitted changes"
fi
