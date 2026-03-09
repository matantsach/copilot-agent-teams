---
name: team-status
description: Use when the user asks about team progress, active teams, or task completion — e.g. "how's the team doing" or "show team status"
---

# Check Team Status

Show a dashboard of team progress.

## Steps

1. Call `copilot-agent-teams/team_status` with the `team_id`
   - If the user didn't specify a team, check the session context or ask which team
2. Format the response as a readable dashboard:
   - **Team**: goal and status
   - **Members**: name and role for each
   - **Tasks**: counts by status (pending / in_progress / completed / blocked / needs_review)
3. Highlight any blocked tasks, tasks awaiting review, or teammates that appear stuck
