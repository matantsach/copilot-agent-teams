---
name: team-stop
description: Use when the user wants to stop a running team, collect results, or wind down agent coordination — e.g. "stop the team" or "wrap up"
---

# Stop a Team

Stop an active team and present the collected results.

## Steps

1. Call `copilot-agent-teams/team_status` to check current state
2. If tasks are still `in_progress` or `pending`, warn the user and ask for confirmation
3. Call `copilot-agent-teams/stop_team` with `team_id` and optional `reason`
4. Present a summary:
   - Completed tasks with their `result` summaries
   - Count of incomplete tasks (if any)
   - Overall outcome relative to the original goal
5. Clean up worktrees:
   - Run `bash "${COPILOT_PLUGIN_ROOT}/scripts/cleanup-worktrees.sh" <team_id>` to remove teammate worktrees
   - Report which branches were created (users may want to review/merge them)
