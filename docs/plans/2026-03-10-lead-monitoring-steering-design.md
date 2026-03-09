# Design: Lead Monitoring & Steering

## Problem

Once a teammate claims a task, the lead is blind until the task completes. The lead cannot see what the teammate is doing, whether they're stuck, or whether they're on the right track. The only intervention tools are `reassign_task` (nuclear — resets to pending) and `send_message` (no priority, no task mutation). This gap means wasted agent cycles on wrong approaches.

## Approach

**Hybrid: .md files for progress reporting, SQL for coordination.**

Teammates write rich progress updates to markdown files. The lead monitors via a single MCP tool that aggregates progress files + SQL state. When intervention is needed, a steering tool sends a priority directive and optionally reassigns the task — atomically.

## Design

### 1. Progress Files

Each teammate maintains a progress file. The path is resolved relative to the teammate's worktree (stored in `members.worktree_path`), or relative to CWD for non-tmux fallback mode.

**Path:** `{worktree_path}/.copilot-teams/progress/{team_id}/{agent_id}.md`

**Format:**
```markdown
# {agent_id} — Task #{id}: {subject}

## 14:30 — Starting
Reading existing billing models in src/models/. Found Invoice and Subscription types.

## 14:33 — Designing webhook handler
Stripe sends events to /webhooks/stripe. Need to verify signatures.
Following the pattern in src/routes/oauth-callback.ts for async handling.

## 14:37 — Tests failing
stripe.webhooks.constructEvent throws in test — mock missing signature header.
Fixing by adding test helper in __tests__/helpers/stripe.ts.
```

**Properties:**
- No new MCP tool for writing — teammates use existing file write capability
- Append-only. Teammate appends after each meaningful step (file edit, test run, dead end, design decision)
- No enforcement mechanism — staleness detection is the safety net
- Prompt-driven: teammate agent prompt includes format example and instruction
- Size guidance in prompt: keep entries 1-3 lines, warn if file exceeds ~50KB

### 2. `monitor_teammates` MCP Tool

Single call gives the lead a full picture. Reads progress files + SQL state.

**Parameters:**
- `team_id` (required)
- `stale_threshold_seconds` (optional, default 120)
- `progress_lines` (optional, default 20 — lines from tail of each .md file)

**What it returns per teammate:**
- Current task (id, subject, status, time elapsed from `claimed_at`)
- Last N lines from progress .md file (or `null` if file doesn't exist yet)
- Staleness flag: file mtime vs `Date.now()`, flagged if over threshold
- Last audit action (from existing `getLastActivity`)
- Unread message count (new `countUnread` DB method — non-consuming)

**Error handling:**
- Per-agent error isolation: filesystem error for one agent doesn't abort the entire response
- `ENOENT` (no progress file yet): returns `progress: null`. If task is `in_progress` and elapsed > threshold, flagged as "potentially stuck — no progress logged yet"
- Path boundary assertion: resolved path must start with expected base dir before any `fs` call

**Example output:**
```
teammate-1  |  Task #2: Stripe billing  |  in_progress  |  12m 30s
  Last update: 2m ago — "Tests failing, fixing stripe mock signature"
  Last action: task_claim (12m ago)
  Unread messages: 0
  Status: OK

teammate-2  |  Task #3: Dashboard UI  |  in_progress  |  8m 15s
  Last update: 6m ago — "Reading existing billing models"
  Last action: task_claim (8m ago)
  Unread messages: 0
  Status: STALE (no update in 6m) — may need steering

teammate-3  |  Task #1: Payment routing  |  needs_review  |  15m 02s
  Last update: 1m ago — "Done. Added /payments route with auth + rate limiting"
  Last action: task_complete (1m ago)
  Unread messages: 0
  Status: OK — awaiting review
```

### 3. `steer_teammate` MCP Tool

One atomic action for the lead to intervene.

**Parameters:**
- `team_id` (required)
- `agent_id` (required)
- `directive` (required) — the steering message
- `reassign` (optional, boolean, default false) — if true, resets the teammate's current in_progress task to pending with `assigned_to = NULL`

**What it does:**
1. Validates lead role (only lead can steer)
2. In a single `BEGIN IMMEDIATE` transaction:
   a. Sends directive as a message with `[PRIORITY]` prefix in content
   b. If `reassign: true`, resets teammate's current in_progress task to pending (same as `reassignTask` but inside the same transaction)
3. Logs `steer` action to audit log

**Why a single DB method:** `sendMessage` and `reassignTask` each open their own transactions. Composing them at the tool layer risks partial execution (message sent but reassign fails). A dedicated `steerTeammate()` method in `TeamDB` wraps both in one transaction.

**Why `[PRIORITY]` prefix instead of a column:** Adding a `priority` column to messages requires schema migration (`ALTER TABLE`) for existing databases. The project has no migration system yet. A content prefix achieves the same behavioral goal (teammate reads it, knows it's urgent) without schema changes. The column can be added in a future version if needed.

### 4. `countUnread` DB Method

New non-consuming method for `monitor_teammates` to display unread counts without marking messages as read.

```typescript
countUnread(teamId: string, agentId: string): number
// SELECT COUNT(*) FROM messages WHERE team_id = ? AND to_agent = ? AND read = 0
```

### 5. Teammate Behavior Changes

No new MCP tools for teammates. Changes are prompt-driven only.

**Agent prompt additions:**
- "After each meaningful step (file edit, test run, design decision, dead end), append a timestamped entry to your progress file at `.copilot-teams/progress/{team_id}/{agent_id}.md`. Keep entries concise (1-3 lines). Include what you did, what you found, and what you're doing next."
- Include literal format example with `## HH:MM — Summary` template
- "After each major step, check `get_messages`. If you receive a message prefixed with `[PRIORITY]`, stop your current approach and follow the directive before continuing."

### 6. `team_status` vs `monitor_teammates` Differentiation

Lead agent prompt clarification:
- `team_status` — quick numeric overview (task counts, member list). Use for "are we done yet?" checks.
- `monitor_teammates` — full narrative picture with progress context. Use for "is everyone on track?" checks and before steering decisions.

## Files Changed

- `src/mcp-server/db.ts` — add `steerTeammate()`, `countUnread()` methods
- `src/mcp-server/types.ts` — no changes (no new DB columns)
- `src/mcp-server/tools/monitoring.ts` — new file, `monitor_teammates` and `steer_teammate` tools
- `src/mcp-server/server.ts` — register new tools
- `agents/teammate.agent.md` — progress reporting + priority message instructions
- `agents/team-lead.agent.md` — monitoring loop + steering instructions + tool differentiation
- `src/mcp-server/__tests__/tools-monitoring.test.ts` — new tests

## What We're NOT Building

- No push notifications / SSE / webhooks — polling is fine for AI agents
- No git diff inspection via MCP — the lead can look at the tmux pane
- No stop/restart teammate — too dangerous, rarely needed
- No peer-to-peer teammate messaging — all communication flows through lead
- No `priority` DB column — content prefix is sufficient for v1
- No progress file rotation — size guidance in prompt is sufficient for v1
- No auto-detection of "off topic" — lead makes that judgment from progress context
