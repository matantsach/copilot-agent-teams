---
name: team-start
description: Use when the user wants to break a complex goal into parallel subtasks worked on by multiple agents — e.g. "use a team to refactor the auth module" or "parallelize this across agents"
---

# Start an Agent Team

Create a team and orchestrate it from the current session.

## Steps

1. Confirm the goal with the user — summarize what the team will accomplish
2. Read the codebase to understand context (use view, grep, glob as needed)
3. Call `copilot-agent-teams/create_team` with `goal` set to the confirmed goal
4. Decompose into independent, parallelizable tasks via `copilot-agent-teams/create_task`
   - Set `blocked_by` for tasks with dependencies
   - Set `assigned_to` to pre-assign tasks to specific teammates
   - Include exact file paths and expected outcomes in descriptions
5. Spawn teammates:
   - Try tmux: `bash "${COPILOT_PLUGIN_ROOT}/scripts/spawn-teammate.sh" <team_id> <agent_id> "<task_description>" [model]`
   - If output is `NOT_IN_TMUX`, use the `agent` tool with prompt:
     "You are <agent_id> on team <team_id>. Register, list_tasks, claim your work, complete it. Task: <description>"
6. Run an initial `copilot-agent-teams/monitor_teammates` check to confirm teammates started
7. Tell the user: "Team is running. I'll surface anything that needs your attention via the hook. Use /team-status anytime to check progress, or ask me to run monitor_teammates for details."

## After Spawning

The hook monitors the team automatically. When it surfaces notifications:
- Read unread messages via `get_messages`
- Check blocked tasks — try to answer the teammate's question from context
- If unsure, ask the user and relay the answer via `steer_teammate`
- Use `monitor_teammates` for full progress details when needed

## Tips

- Run inside tmux for parallel teammates in separate panes
- Set `TEAMMATE_MODEL` env var to customize teammate model (default: claude-sonnet-4-6)
- Typical team: 2-4 teammates with independent task groups
