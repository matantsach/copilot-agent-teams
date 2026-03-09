---
name: team-start
description: Start a new agent team to work on a complex goal
---

Start a new agent team by calling `copilot-agent-teams/create_team` with the user's goal, then invoke the `team-lead` agent to orchestrate the work.

Steps:
1. Call `copilot-agent-teams/create_team` with the goal argument
2. Note the returned `team_id`
3. Invoke the `team-lead` agent with the goal and team_id

Tip: Run inside a tmux session for parallel teammates with live progress.
Set `TEAMMATE_MODEL` to customize the model (default: claude-sonnet-4-6).
