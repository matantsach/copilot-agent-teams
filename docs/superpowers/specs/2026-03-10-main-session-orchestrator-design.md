# Design: Main-Session Orchestrator with Peer Communication

**Date**: 2026-03-10
**Status**: Draft (Revision 3)

## Problem

The current architecture spawns the team-lead as a sub-agent when the user runs `/team-start`. This has three problems:

1. The sub-agent loses the user's conversation context and can't ask the user questions
2. The user can't interact with the team lead naturally — they're limited to `/team-status` polling
3. Teammates can only communicate through the lead (hub-and-spoke), creating a bottleneck

## Requirements

1. The main session where `/team-start` is invoked becomes the orchestrator (no sub-agent lead)
2. The user interacts directly with the team lead in the same session
3. Teammates can escalate questions to the lead, which tries to answer and forwards to the human if unsure
4. Teammates are aware of each other and can communicate directly
5. The lead gets copies of all inter-teammate messages to stay informed

## Design

### 1. Main Session Becomes the Lead

**Current flow:**
```
/team-start → skill confirms goal → skill calls create_team → skill invokes team-lead agent (sub-agent)
```

**New flow:**
```
/team-start → skill confirms goal → skill calls create_team → skill runs orchestration inline
```

The `team-start` skill expands to include the orchestration workflow that currently lives in `team-lead.agent.md`: decompose the goal into tasks, spawn teammates, and return control to the user with monitoring active via the hook.

**Lead self-registration**: After `create_team` (which creates the team and a lead member row), the main session is the lead. The existing `create_team` tool already calls `db.createTeam()` which inserts a member with `role = 'lead'` and `agent_id = 'lead'`. No additional registration is needed.

**`team-lead.agent.md`**: Kept with a deprecation notice and redirect to the skill-based workflow. Preserved as a fallback for non-interactive/CI scenarios where a sub-agent lead is appropriate.

### 2. Lightweight Monitoring via Hook

The existing `postToolUse` hook (`nudge-messages.ts`) is enhanced with two focused checks. It stays lightweight — no file I/O, no state tracking, just two fast SQL queries.

**Current hook behavior:**
- Checks if active teams exist
- Prints generic reminder: "check get_messages for team messages"

**New hook behavior (two checks only):**

1. **Unread messages for the lead** — `SELECT COUNT(*) FROM messages WHERE team_id = ? AND to_agent = 'lead' AND read = 0`
2. **Escalated blocks** — `SELECT id, subject, assigned_to FROM tasks WHERE team_id = ? AND status = 'blocked' AND (blocked_by IS NULL OR blocked_by = '[]')`

**Output format (only when actionable):**
```
[agent-teams] Team <id>: 3 unread messages, 1 blocked task needing input — use monitor_teammates for details
```

Silent when nothing is actionable. A single summary line per team, directing to `monitor_teammates` for the full picture. This keeps the hook fast (two queries, no file I/O) and well within the 3-second timeout.

**No hook state file needed.** Unread messages already have a `read` flag (idempotent). Blocked tasks are either blocked or not. Both queries are naturally idempotent — repeated calls show the same counts until the state changes.

**Failure resilience:** The hook wraps all DB access in try/catch. On any error, it fails silently (no output) rather than blocking the session. The existing `console.error(e)` pattern is preserved for debugging.

**What the hook does NOT do** (these are handled by `monitor_teammates` on demand):
- Staleness detection (requires file I/O for progress files)
- Completion notifications (visible via `team_status` or `list_tasks`)
- Message content previews (would require a non-destructive read method)

### 3. Teammate Escalation via Message + Blocked Status

When a teammate has a question it can't resolve:

1. Teammate sends a message to the lead via `send_message` with a descriptive question
2. Teammate calls `update_task` with `status: "blocked"` to signal they're waiting
3. The hook detects the unread message and the blocked task, surfaces a summary
4. The main session (lead + human) sees the notification and calls `monitor_teammates` for details, then reads messages via `get_messages`
5. If the lead (LLM) can answer from context, it calls `steer_teammate` with the answer
6. If the lead is unsure, it asks the human in the conversation. The human's response is relayed via `steer_teammate`
7. The teammate receives the `[PRIORITY]` message and calls `update_task` with `status: "in_progress"` to self-unblock

**State machine change required:** Add `blocked -> in_progress` to `VALID_TRANSITIONS` in `db.ts`. Currently only `blocked -> pending` exists (for auto-unblock when dependencies complete). The new transition allows teammates to self-unblock after receiving an answer.

**Tool schema change required:** Expand the `update_task` Zod schema to accept `"in_progress"` in addition to `"completed"` and `"blocked"`. This enables teammates to resume work after being unblocked.

**Why message + blocked (not just blocked with overloaded result)?** The `result` field's semantic is "output/summary of completed work." Overloading it for questions creates a dual-meaning field. Using `send_message` for the question keeps communication in the messaging channel where it belongs. The `blocked` status is purely a state signal — "I'm waiting."

**Teammate instructions for escalation:**
```
If you have a question you can't resolve from context:
1. Send the question to the lead via send_message
2. Set your task to blocked via update_task with status "blocked"
3. Wait for a [PRIORITY] message with the answer
4. Resume work by calling update_task with status "in_progress"
```

### 4. Peer-to-Peer Communication with Lead CC

**DB schema change**: None. The message schema already supports any-to-any messaging.

**CC logic lives in the tool layer (`messaging.ts`), not the DB layer (`db.ts`).** This keeps `db.ts` as a clean data access layer and puts business policy (CC routing) where it's visible and changeable.

**Implementation in `send_message` tool handler (`messaging.ts`):**

```typescript
// After the normal db.sendMessage(teamId, from, to, content):
const members = db.getMembers(teamId);
const fromMember = members.find(m => m.agent_id === from);
const toMember = members.find(m => m.agent_id === to);
const leadId = members.find(m => m.role === 'lead')?.agent_id;

if (fromMember?.role === 'teammate' && toMember?.role === 'teammate' && leadId) {
  db.sendMessage(teamId, from, leadId, `[CC to ${to}]: ${content}`);
}
```

**Transaction safety:** The CC insert is a second `db.sendMessage` call — a separate INSERT. If the CC fails, the original message is already delivered (which is the correct priority — teammate communication succeeds, CC is best-effort). This avoids the complexity of wrapping both in a transaction. The lead missing a CC is acceptable; the teammate missing a message is not.

**Why best-effort CC (not transactional)?** The original message is the primary operation. Rolling back a successfully sent message because the CC failed would break teammate communication for a monitoring concern. The lead has other visibility channels (`monitor_teammates`, `get_messages`, audit log).

**Broadcast behavior:** When a teammate calls `broadcast`, the existing code already sends individual messages to all members including the lead. No CC needed — the lead is already a recipient. No `[CC]` prefix on broadcast messages.

**Teammate agent updates (`teammate.agent.md`) — four new sections:**

1. **Teammate Discovery**: After registration, call `team_status` to see other teammates and their assigned tasks. Call `list_tasks` for detailed task descriptions. Re-check after completing each task to discover newly spawned teammates.

2. **Peer Communication**: When your work affects another teammate's files or APIs, message them directly via `send_message`. Use `broadcast` for team-wide announcements (e.g., "I changed the shared config format"). The lead automatically receives a CC of direct peer messages.

3. **Escalation**: See section 3 above (message + blocked).

4. **Handling CC/Peer Messages**: When you receive a message from another teammate, treat it as informational context. Adjust your approach if relevant. No need to acknowledge unless a response is warranted.

### 5. DB and Tool Changes

#### `db.ts` — Three Changes

1. **Add `blocked -> in_progress` to `VALID_TRANSITIONS`:**
   ```typescript
   blocked: ["pending", "in_progress"],
   ```

2. **Clear `blocked_by` on self-block**: When `updateTask` transitions a task from `in_progress` to `blocked`, set `blocked_by = NULL`. The original dependency blockers are no longer relevant — the teammate is blocking for a different reason (escalation). This ensures the hook query `(blocked_by IS NULL OR blocked_by = '[]')` reliably detects all escalation-blocked tasks, including those that originally had dependency blockers.

3. **Add `getLeadId(teamId)` helper:**
   ```typescript
   getLeadId(teamId: string): string | null {
     const row = this.db.get(
       'SELECT agent_id FROM members WHERE team_id = ? AND role = ?',
       [teamId, 'lead']
     );
     return row ? (row as any).agent_id : null;
   }
   ```

#### `tools/tasks.ts` — Two Changes

1. Expand `update_task` Zod schema:
   ```typescript
   status: z.enum(["completed", "blocked", "in_progress"]),
   ```

2. Update `actionType` derivation to handle the new status:
   ```typescript
   const actionType = status === "completed" ? "task_complete"
     : status === "in_progress" ? "task_resume"
     : "task_block";
   ```
   Note: `update_task` with `status: "in_progress"` is only valid from the `blocked` state (self-unblock). Calling it from `in_progress` will fail with "invalid transition: in_progress -> in_progress".

#### `tools/messaging.ts` — One Change

Add CC logic after `send_message` (see section 4 pseudocode).

### 6. Skill Changes

#### `team-start/SKILL.md` — Rewrite

```markdown
## Steps

1. Confirm the goal with the user — summarize what the team will accomplish
2. Read the codebase to understand context (use view, grep, glob as needed)
3. Call `copilot-agent-teams/create_team` with `goal` set to the confirmed goal
4. Decompose into independent, parallelizable tasks via `copilot-agent-teams/create_task`
   - Set `blocked_by` for tasks with dependencies
   - Set `assigned_to` to pre-assign tasks to specific teammates
   - Include exact file paths and expected outcomes in descriptions
5. Spawn teammates:
   - Try tmux: `bash scripts/spawn-teammate.sh <team_id> <agent_id> "<task_description>" [model]`
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
```

#### `team-stop/SKILL.md` — No Change

Already works from the main session. No hook state file to clean up.

#### `team-status/SKILL.md` — No Change

Already works from the main session.

### 7. File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `skills/team-start/SKILL.md` | Rewrite | Inline orchestration, no sub-agent |
| `agents/team-lead.agent.md` | Deprecate | Add deprecation notice, keep as fallback |
| `agents/teammate.agent.md` | Update | Add 4 sections: discovery, peer comms, escalation, handling CC |
| `src/hooks/nudge-messages.ts` | Update | Two focused checks: unread count + blocked-without-blockers |
| `src/mcp-server/db.ts` | Minor update | Add `blocked→in_progress` transition, clear `blocked_by` on self-block, add `getLeadId()` |
| `src/mcp-server/tools/tasks.ts` | Minor update | Expand `update_task` schema to accept `"in_progress"` |
| `src/mcp-server/tools/messaging.ts` | Minor update | Add CC logic for teammate-to-teammate messages |
| `src/mcp-server/__tests__/tools-messaging.test.ts` | Add tests | CC behavior, best-effort semantics |
| `src/mcp-server/__tests__/tools-tasks.test.ts` | Add tests | `blocked→in_progress` transition, self-unblock |
| `src/hooks/__tests__/hooks.test.ts` | Rewrite tests | See test rewrite section below |
| `dist/` | Rebuild | After all changes |

### 8. What Doesn't Change

- Task board tools (create, claim, list, approve, reject, reassign) — signatures unchanged
- Team lifecycle tools (create_team, stop_team, team_status) — signatures unchanged
- Spawn mechanism (tmux panes via spawn-teammate.sh, agent fallback)
- Progress file reporting by teammates
- SQLite schema (no migrations needed)
- Monitoring tools (monitor_teammates, steer_teammate) — still available for manual use
- Database transactions and atomicity guarantees
- Git worktree isolation per teammate
- All existing MCP tool signatures — purely additive changes

### 9. Edge Cases

**Multiple active teams**: The hook checks all active teams. Output is one summary line per team with the team ID.

**Teammate messages lead while user is typing**: The hook runs after tool calls, not mid-conversation. Messages queue up and surface on the next tool call.

**Teammate blocks without sending a question first**: The hook detects the blocked task. The lead sees "1 blocked task needing input" and can call `monitor_teammates` or `get_messages` to investigate. The teammate instructions say to send a message first, but the system handles the case where they don't.

**CC insert fails**: The original teammate-to-teammate message is already delivered. The lead misses the CC but has other visibility channels (audit log, `monitor_teammates`). No rollback of the original message.

**Lead leaves and comes back**: All state is in SQLite. Running `/team-status` in a new session shows the full picture. The hook resumes monitoring on the next tool call.

**Partial spawn failure**: If teammate spawning fails midway, the team remains active with the successfully-spawned teammates. The user can manually spawn additional teammates or ask the lead to retry. Failed spawns are visible in the task board (unclaimed tasks with no teammate registered).

**Hook DB error**: The hook wraps all DB access in try/catch. On failure, it produces no output and fails silently. The user can still check status manually via `/team-status`.

**Teammate discovers no peers yet (spawned first)**: Teammates re-discover peers by calling `team_status` after completing each task. Early teammates will see peers appear as they register.

**Task with original dependency blockers gets escalation-blocked**: When a teammate calls `update_task` with `status: "blocked"` from `in_progress`, the `blocked_by` field is cleared to `NULL`. This ensures the hook correctly identifies it as an escalation (not a dependency wait). The original dependency information is no longer relevant since those dependencies were already satisfied when the task was claimed.

**Active team with no actionable items**: The hook produces no output. This is intentional — silence means "everything is running smoothly." The user can always check with `/team-status` or `monitor_teammates`.

### 10. Hook Test Rewrite

The existing hook test ("outputs reminder when active teams exist") creates a bare team with no members, messages, or blocked tasks and asserts `toContain("get_messages")`. This test must be rewritten to match the new behavior:

1. **Silent when nothing actionable**: Create a team with no messages or blocked tasks → assert empty output
2. **Shows unread count**: Create a team, register the lead, send a message to the lead → assert output contains unread count
3. **Shows blocked escalation**: Create a team, create a task, claim it, set it to blocked (from in_progress) → assert output contains blocked task info
4. **Shows both**: Combine unread messages and blocked tasks → assert combined summary line

These tests validate the new hook contract: actionable events produce output, no events produce silence.

### 11. Migration

- All MCP tool signatures are unchanged — existing callers are unaffected
- DB schema is unchanged — no migration needed
- The `team-lead.agent.md` file is kept with a deprecation notice, not removed
- Hook output format changes from a generic reminder to a structured summary — any consumers parsing hook output should adapt
- The `/team-start` skill behavior changes from "spawn sub-agent" to "inline orchestration" — this is the core behavioral change and is intentional
