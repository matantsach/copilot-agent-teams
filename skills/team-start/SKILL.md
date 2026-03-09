---
name: team-start
description: Use when the user wants to break a complex goal into parallel subtasks worked on by multiple agents — e.g. "use a team to refactor the auth module" or "parallelize this across agents"
---

# Start an Agent Team

Create a team and hand off to the team-lead agent for orchestration.

## Steps

1. Confirm the goal with the user — summarize what the team will accomplish
2. Call `copilot-agent-teams/create_team` with `goal` set to the confirmed goal
3. Note the returned `team_id`
4. Invoke the `team-lead` agent with: `"Team <team_id> — goal: <goal>"`

## Tips

- Run inside **tmux** for parallel teammates with live progress in separate panes
- Set `TEAMMATE_MODEL` env var to customize teammate model (default: `claude-sonnet-4-6`)
- The team-lead will handle task decomposition, spawning, and coordination
