# Copilot Agent Teams Plugin — Design Document

## Goal

Build a GitHub Copilot CLI plugin that adds multi-agent team coordination — a team lead decomposes complex goals into tasks, spawns teammates that work on independent subtasks, and coordinates them via a shared task board and direct messaging.

## Approach

**MCP-First architecture.** The coordination layer is a Node.js MCP server exposing team management, task board, and messaging tools. Agent definitions and skills are thin wrappers around these MCP tools. SQLite backs all state for concurrent access and session persistence.

## Plugin Structure

```
copilot-agent-teams/
├── plugin.json                  # Plugin manifest
├── .mcp.json                    # MCP server registration (stdio)
├── hooks.json                   # Lifecycle hooks (version 1 schema)
├── package.json                 # Node.js dependencies
├── src/
│   └── mcp-server/
│       ├── index.ts             # Entry point (stdio transport)
│       ├── db.ts                # SQLite state management
│       ├── tools/
│       │   ├── team.ts          # create_team, stop_team, team_status, register_teammate
│       │   ├── tasks.ts         # create_task, claim_task, update_task, list_tasks
│       │   └── messaging.ts     # send_message, get_messages, broadcast
│       └── types.ts             # Shared types
├── src/hooks/
│   ├── check-active-teams.ts    # sessionStart hook (Node.js, no system sqlite3)
│   └── nudge-messages.ts        # postToolUse hook (conditional, silent when no teams)
├── agents/
│   ├── team-lead.agent.md       # Orchestrator agent
│   └── teammate.agent.md        # Base teammate agent
├── skills/
│   ├── team-start/SKILL.md      # /team-start
│   ├── team-status/SKILL.md     # /team-status
│   └── team-stop/SKILL.md       # /team-stop
└── README.md
```

**Build strategy:** The MCP server and hook scripts are bundled with esbuild into `dist/` (JS output + WASM sidecar). The `dist/` directory is committed to the repo because `/plugin install` does not run build steps. Uses `node-sqlite3-wasm` (WASM-based, no native addons) so the bundle is fully portable across platforms.

## MCP Server Tools

All tools are namespaced under the `copilot-agent-teams` server name. Agents reference them as `copilot-agent-teams/tool_name` or `copilot-agent-teams/*`.

### Team Management

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_team` | `goal`, `config?` | Create a team. Returns team_id. Registers the caller as lead. |
| `team_status` | `team_id` | Team overview: members, task progress counts. |
| `stop_team` | `team_id`, `reason?` | Wind down team, collect completed task results. |
| `register_teammate` | `team_id`, `agent_id` | Teammate self-registers on spawn. Idempotent — safe to retry on failure. Required before using other tools. |

### Task Board

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_task` | `team_id`, `subject`, `description?`, `assigned_to?`, `blocked_by?` | Add task. `blocked_by` is an array of task IDs (validated to exist in same team). Tasks with blockers auto-set to `blocked` status. |
| `claim_task` | `task_id`, `agent_id` | Atomically claim a task. Enforces blocked_by. Respects pre-assignment — only the assigned agent or anyone if unassigned. |
| `update_task` | `task_id`, `status`, `result?` | Mark in_progress/completed/blocked. `result` required when completing. Enforces valid state transitions only (see below). |
| `reassign_task` | `task_id`, `agent_id`, `reason?` | Lead-only (enforced — checks caller's role in members table). Resets an `in_progress` task back to `pending` with `assigned_to` cleared. For recovering stuck tasks. |
| `list_tasks` | `team_id`, `status?`, `assigned_to?`, `limit?`, `offset?` | Paginated task list, filterable by status/assignee. Default limit 20. |

### Messaging

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `send_message` | `team_id`, `from`, `to`, `content` | Direct message to a teammate or "lead". |
| `broadcast` | `team_id`, `from`, `content` | Message all teammates. Expands to per-recipient rows so each agent has independent read tracking. |
| `get_messages` | `team_id`, `for_agent`, `since?` | Poll inbox. Returns unread messages. Atomic read-and-mark-as-read. Per-recipient tracking for broadcasts. |

### Design Decisions

- **No real-time push** — agents poll `get_messages`. The `postToolUse` hook nudges agents to check after completing work.
- **Results on tasks** — when completing a task, the teammate writes a summary to `result`. The lead reads these to synthesize without needing full teammate context.
- **Agent IDs** — validated format: `^[a-z0-9-]+$`, max 50 chars. Examples: "lead", "teammate-1", "teammate-2".
- **Atomic claim** — `claim_task` wraps blocker checks + atomic UPDATE in a single `BEGIN IMMEDIATE` transaction. The UPDATE uses `WHERE id = ? AND status = 'pending' AND (assigned_to IS NULL OR assigned_to = ?)`. Prevents TOCTOU races between blocker check and claim.
- **Dependency enforcement** — `claim_task` checks that all `blocked_by` tasks are `completed` before allowing a claim. Tasks with blockers are auto-set to `blocked` on creation; auto-unblocked (set to `pending`) when all blockers complete. Both check and unblock are transactional.
- **State transitions** — `update_task` enforces a state machine: `pending→in_progress` (via claim_task only), `in_progress→completed` (requires `result`), `in_progress→blocked`, `blocked→pending` (auto-unblock only). Invalid transitions are rejected. Prevents agents from reverting completed tasks.
- **Task recovery** — `reassign_task` (lead-only) resets `in_progress→pending` with `assigned_to` cleared, allowing stuck tasks to be re-claimed by another agent.
- **Idempotent registration** — `register_teammate` uses `INSERT OR IGNORE` so retries after transient failures don't throw.
- **Broadcast atomicity** — broadcast expansion (inserting per-recipient rows) is wrapped in a transaction to prevent partial delivery on crash.
- **Sender and recipient validation** — `send_message` validates both `from` (sender) and `to` (recipient) are registered members of the team.
- **Active team enforcement** — all mutating tools (`create_task`, `claim_task`, `update_task`, `reassign_task`, `send_message`, `broadcast`) verify the team is active. Read-only tools (`team_status`, `get_messages`, `list_tasks`) allow querying stopped teams.
- **Blocker validation** — `create_task` validates that all `blocked_by` task IDs exist and belong to the same team.
- **Team existence check** — all mutating tools verify the team exists and is active. Read-only tools (`team_status`, `get_messages`) allow querying stopped teams.
- **Zod-typed schemas** — all tool inputs are validated via Zod (e.g., `blocked_by` is `z.array(z.number())`). No raw JSON.parse in tool handlers.

## Team Lead Agent

```yaml
---
name: team-lead
description: Orchestrates multi-agent teams for complex tasks. Use when a goal requires decomposition into parallel subtasks worked on by independent agents.
tools:
  - copilot-agent-teams/*
  - bash
  - read
  - search
  - agent
---
```

The `agent` tool is required — it enables the team lead to spawn teammate subagents via the built-in Task tool.

Responsibilities:
1. Analyze the codebase using read/search/bash to understand context
2. Call `create_team` with the goal
3. Decompose into independent, parallelizable tasks via `create_task` (use `blocked_by` for dependencies)
4. Spawn teammates via the `agent` tool, passing `team_id` and `agent_id` in the prompt
5. After spawning, enter a monitoring loop: check `team_status` and `get_messages`, intervene if teammates are stuck
6. Once all tasks complete, read task results and synthesize a summary
7. Call `stop_team`

**Note:** Teammates share the working directory by default. The team lead should decompose tasks to avoid file conflicts (e.g., different modules, different test files). For truly isolated work, the team lead can instruct teammates to work in subdirectories.

## Teammate Agent

```yaml
---
name: teammate
description: Team member that works on tasks from the shared board. Spawned by the team lead.
tools:
  - copilot-agent-teams/*
  - bash
  - read
  - edit
  - search
---
```

Behavior:
1. On spawn — call `register_teammate` with the `team_id` and `agent_id` from the prompt
2. Call `list_tasks` to see assigned/available work
3. `claim_task` on an assigned or unassigned task
4. Do the work using code tools
5. `update_task` with status `completed` and a concise `result` summary
6. `get_messages` — check for messages after each task
7. `list_tasks` again — pick up next task or notify lead if done

## Skills (Slash Commands)

- `/team-start <goal>` — Calls `copilot-agent-teams/create_team`, then invokes the team-lead agent.
- `/team-status [team_id]` — Calls `copilot-agent-teams/team_status`, formats a dashboard.
- `/team-stop [team_id]` — Calls `copilot-agent-teams/stop_team`, shows final results.

## Hooks

Uses Copilot CLI hooks.json v1 schema:

- **`sessionStart`** — Node.js script checks `.copilot-teams/teams.db` for active teams. Prints reminder with team IDs and goals.
- **`postToolUse`** — First checks if `.copilot-teams/teams.db` exists via bash `test -f` (avoids Node.js startup cost when no DB). If DB exists, Node.js script checks for active teams and prints a message reminder. Silent when no teams are active.

## SQLite Schema

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','stopped')),
  config TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked')),
  assigned_to TEXT,
  blocked_by TEXT,              -- JSON array of task IDs
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  from_agent TEXT NOT NULL,
  to_agent TEXT,                -- null = broadcast (expanded to per-recipient rows)
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT 'teammate' CHECK(role IN ('lead','teammate')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','idle','finished')),
  PRIMARY KEY (team_id, agent_id)
);

-- Indexes for concurrent multi-agent queries
CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(team_id, read, to_agent);
```

**SQLite configuration:**
- `PRAGMA journal_mode = WAL` — concurrent reads during writes
- `PRAGMA foreign_keys = ON` — enforce referential integrity
- `PRAGMA busy_timeout = 5000` — wait up to 5s for write lock instead of immediate SQLITE_BUSY

## Distribution

Open source public GitHub repo. The `dist/` directory is committed (bundled with esbuild) since `/plugin install` does not run build steps.

Install: `copilot plugin install owner/copilot-agent-teams`

Designed so organizations can fork and customize agent definitions, add domain-specific teammates, or extend the MCP tools.

## Key Architectural Principles

- **MCP is the brain** — all coordination goes through MCP tools. Agents, skills, and hooks are thin interfaces.
- **SQLite for state** — atomic operations, concurrent access with WAL + busy_timeout, session persistence. Single `.copilot-teams/teams.db` file per project.
- **Hybrid coordination** — team lead orchestrates, but teammates message each other directly.
- **Shared workspace** — teammates work in the same directory. Task decomposition should minimize file conflicts. No worktree isolation (not supported by the Task tool).
- **Polling over push** — agents check `get_messages`; `postToolUse` hook nudges them to do so.
- **Atomic operations** — `claim_task` wraps blocker check + UPDATE in `BEGIN IMMEDIATE` transaction. `get_messages` uses a transaction for read-and-mark-as-read. Broadcast expansion is transactional. `update_task` completion + auto-unblock is transactional.
- **Graceful shutdown** — MCP server process handles SIGINT/SIGTERM to close the database cleanly.
