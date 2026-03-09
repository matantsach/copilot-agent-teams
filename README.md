# copilot-agent-teams

Multi-agent team coordination plugin for GitHub Copilot CLI. A team lead decomposes complex goals into tasks, spawns teammates that work on independent subtasks, and coordinates them via a shared task board and direct messaging.

## Install

```bash
copilot plugin install owner/copilot-agent-teams
```

## Usage

### Start a team

```
/team-start Build a REST API with auth, database, and tests
```

The team lead agent analyzes your codebase, creates a team, decomposes the goal into tasks, spawns teammates, and monitors progress.

### Check status

```
/team-status
```

### Stop a team

```
/team-stop
```

## Architecture

**MCP-first.** All coordination goes through an MCP server exposing 12 tools across three modules:

- **Team management** — `create_team`, `register_teammate`, `team_status`, `stop_team`
- **Task board** — `create_task`, `claim_task`, `update_task`, `reassign_task`, `list_tasks`
- **Messaging** — `send_message`, `broadcast`, `get_messages`

**SQLite (WASM)** backs all state. Uses `node-sqlite3-wasm` — no native addons, fully portable across platforms. WAL mode + busy_timeout for concurrent multi-agent access. Atomic operations prevent race conditions.

**Agents:**
- `team-lead` — orchestrator that decomposes goals, spawns teammates, monitors progress
- `teammate` — worker that claims tasks, does the work, reports results

## Development

```bash
npm install
npm test        # run all tests
npm run build   # bundle to dist/
```

## License

MIT
