# copilot-agent-teams

[![CI](https://github.com/MatanTsach/copilot-agent-teams/actions/workflows/ci.yml/badge.svg)](https://github.com/MatanTsach/copilot-agent-teams/actions/workflows/ci.yml)

Multi-agent team coordination plugin for GitHub Copilot CLI. A team lead decomposes complex goals into tasks, spawns teammates that work on independent subtasks, and coordinates them via a shared task board and direct messaging.

## Install

```bash
copilot plugin install MatanTsach/copilot-agent-teams
```

## Quick Start

```
/team-start Build a REST API with auth, database, and tests
```

The team lead agent analyzes your codebase, creates a team, decomposes the goal into tasks, spawns teammates, and monitors progress until all tasks are complete.

```
/team-status          # check progress
/team-stop            # stop a team and collect results
```

## Tmux Support

Run inside a tmux session for **true parallel execution** — each teammate gets its own pane with live, visible progress:

```bash
tmux
# then inside tmux:
/team-start Refactor the auth module and add tests
```

Teammates spawn in separate tmux panes. You can switch to any pane and interact with that teammate directly.

### Model Selection

Teammates default to `claude-sonnet-4-6`. Customize with:

```bash
# Environment variable (applies to all teammates)
export TEAMMATE_MODEL=claude-opus-4-6

# Or per-teammate via the team lead
bash scripts/spawn-teammate.sh <team_id> <agent_id> "<task>" claude-opus-4-6
```

Without tmux, teammates run as subagents via the built-in `agent` tool (sequential, not parallel).

## Architecture

**MCP-first.** All coordination goes through an MCP server exposing 12 tools across three modules:

- **Team management** — `create_team`, `register_teammate`, `team_status`, `stop_team`
- **Task board** — `create_task`, `claim_task`, `update_task`, `reassign_task`, `list_tasks`
- **Messaging** — `send_message`, `broadcast`, `get_messages`

**SQLite (WASM)** backs all state. Uses `node-sqlite3-wasm` — no native addons, fully portable across platforms. WAL mode for concurrent reads/writes. Atomic transactions prevent race conditions between agents.

**Agents:**
- `team-lead` — orchestrator that decomposes goals, spawns teammates, monitors progress
- `teammate` — worker that claims tasks, does the work, reports results

**Key design decisions:**
- Atomic `claim_task` with `BEGIN IMMEDIATE` transactions to prevent race conditions
- Broadcast messages expand to per-recipient rows for independent read tracking
- State transition enforcement (`pending` → `in_progress` → `completed`/`blocked`)
- Lead-only authorization on `reassign_task`
- Conditional hooks — silent when no teams are active

## Development

```bash
npm install
npm test              # run all 56 tests
npm run build         # bundle to dist/
npm run test:watch    # watch mode
```

## How It Works

1. `/team-start` creates a team and invokes the team lead agent
2. The team lead analyzes the codebase and decomposes the goal into tasks
3. Teammates are spawned (tmux panes or subagents) and self-register
4. Each teammate claims tasks, does the work, and reports results
5. The team lead monitors progress and intervenes if needed
6. Once all tasks complete, the lead synthesizes results and stops the team

All coordination happens through MCP tools backed by SQLite. The database lives at `.copilot-teams/teams.db` in the project root.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
