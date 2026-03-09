---
name: team-status
description: Show the status of an active agent team
---

Show team status by calling `copilot-agent-teams/team_status`.

If no team_id is provided, list recent teams from the database.
Format the output as a readable dashboard showing:
- Team goal and status
- Member list with roles
- Task counts by status (pending, in_progress, completed, blocked)
