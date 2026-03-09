# Copilot Agent Teams Plugin — Design Document

## Goal

Build a GitHub Copilot CLI plugin that adds multi-agent team coordination — a team lead decomposes complex goals into tasks, spawns teammates that work independently in isolated worktrees, and coordinates them via a shared task board and direct messaging.

## Approach

**MCP-First architecture.** The coordination layer is a Node.js MCP server exposing team management, task board, and messaging tools. Agent definitions and skills are thin wrappers around these MCP tools. SQLite backs all state for concurrent access and session persistence.

## Plugin Structure

```
copilot-agent-teams/
├── plugin.json                  # Plugin manifest
├── .mcp.json                    # MCP server registration
├── hooks.json                   # Lifecycle hooks
├── package.json                 # Node.js dependencies
├── src/
│   └── mcp-server/
│       ├── index.ts             # Entry point (stdio transport)
│       ├── db.ts                # SQLite state management
│       ├── tools/
│       │   ├── team.ts          # create_team, stop_team, team_status
│       │   ├── tasks.ts         # create_task, claim_task, complete_task, list_tasks
│       │   └── messaging.ts     # send_message, get_messages, broadcast
│       └── types.ts             # Shared types
├── agents/
│   ├── team-lead.agent.md       # Orchestrator agent
│   └── teammate.agent.md        # Base teammate agent
├── skills/
│   ├── team-start/SKILL.md      # /team-start
│   ├── team-status/SKILL.md     # /team-status
│   └── team-stop/SKILL.md       # /team-stop
└── README.md
```

## MCP Server Tools

### Team Management

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_team` | `goal`, `config?` | Create a team with a goal. Returns team_id. |
| `team_status` | `team_id` | Get team overview: members, task progress, active work. |
| `stop_team` | `team_id`, `reason?` | Wind down team, collect results. |

### Task Board

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `create_task` | `team_id`, `subject`, `description`, `assigned_to?`, `blocked_by?` | Add task to the board. |
| `claim_task` | `task_id`, `agent_id` | Teammate claims an unassigned task. |
| `update_task` | `task_id`, `status`, `result?` | Mark in_progress/completed/blocked with optional result summary. |
| `list_tasks` | `team_id`, `filter?` | Get tasks, filterable by status/assignee. |

### Messaging

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `send_message` | `team_id`, `from`, `to`, `content` | Direct message to a teammate or "lead". |
| `broadcast` | `team_id`, `from`, `content` | Message all teammates. |
| `get_messages` | `team_id`, `for_agent`, `since?` | Poll inbox. |

### Design Decisions

- **No real-time push** — agents poll `get_messages` because Copilot CLI MCP is request/response. Hooks nudge agents to check.
- **Results on tasks** — when completing a task, the teammate writes a summary to `result`. The lead reads these to synthesize without needing full teammate context.
- **Agent IDs are simple strings** — "lead", "teammate-1", "teammate-2". No UUID overhead.

## Team Lead Agent

The team lead orchestrates multi-agent teams for complex tasks. It has access to all coordination MCP tools plus read-only code tools (bash, read, glob, grep) for initial codebase analysis.

Responsibilities:
1. Decompose the user's goal into independent, parallelizable tasks
2. Spawn teammates via the Agent tool with isolation (worktree by default, configurable)
3. Assign tasks — create tasks on the board, either pre-assigned or let teammates claim
4. Monitor — periodically check team_status and list_tasks
5. Coordinate — use blocked_by for task dependencies
6. Synthesize — once all tasks complete, read task results and produce a unified summary
7. Intervene — if a teammate is stuck, message them or reassign

## Teammate Agent

Teammates work on assigned tasks from the shared board. They have full code tools plus coordination MCP tools.

Behavior:
1. On spawn — receive agent_id and team_id in the prompt. Check list_tasks for assigned/available work.
2. Claim and work — claim a task, mark it in_progress, do the work.
3. Communicate — if blocked or needs input, use send_message. Check get_messages after each task.
4. Report results — update_task with status completed and concise result summary.
5. Pick up next task — check list_tasks for more work. If nothing, notify the lead.
6. Isolation — spawned with worktree isolation by default (configurable).

## Skills (Slash Commands)

- `/team-start <goal>` — Creates a team, invokes team-lead with the goal. Shows team_id.
- `/team-status [team_id]` — Calls team_status and list_tasks, formats a dashboard.
- `/team-stop [team_id]` — Calls stop_team, shows final results.

## Hooks

- `sessionStart` — Checks for active teams in DB. Prints reminder with status if resuming.
- `postToolUse` — After agent completes work, nudges it to check get_messages.

## SQLite Schema

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- active, completed, stopped
  config TEXT,                    -- JSON blob for team settings
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT REFERENCES teams(id),
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',  -- pending, in_progress, completed, blocked
  assigned_to TEXT,               -- agent_id
  blocked_by TEXT,                -- JSON array of task IDs
  result TEXT,                    -- completion summary
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT REFERENCES teams(id),
  from_agent TEXT NOT NULL,
  to_agent TEXT,                  -- null = broadcast
  content TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE members (
  team_id TEXT REFERENCES teams(id),
  agent_id TEXT NOT NULL,
  role TEXT DEFAULT 'teammate',   -- lead, teammate
  status TEXT DEFAULT 'active',   -- active, idle, finished
  worktree_path TEXT,
  PRIMARY KEY (team_id, agent_id)
);
```

## Distribution

Open source public GitHub repo, installable via `/plugin install owner/repo`. Designed so organizations can fork and customize agent definitions, add domain-specific teammates, or extend the MCP tools.

## Key Architectural Principles

- **MCP is the brain** — all coordination goes through MCP tools. Agents, skills, and hooks are thin interfaces.
- **SQLite for state** — atomic operations, concurrent access, session persistence. Single `.copilot-teams/teams.db` file per project.
- **Hybrid coordination** — team lead orchestrates, but teammates message each other directly.
- **Worktree isolation by default** — prevents file conflicts. Configurable per-spawn for read-only work.
- **Polling over push** — agents check get_messages; hooks nudge them to do so.
