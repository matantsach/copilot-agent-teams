# Main-Session Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the team-lead from a sub-agent to the main session orchestrator, enable peer-to-peer teammate communication with lead CC, and add teammate escalation via blocked status + messaging.

**Architecture:** The main session becomes the team lead (no sub-agent). The `team-start` skill inlines the orchestration workflow. Teammates can communicate peer-to-peer with automatic CC to the lead. The `postToolUse` hook surfaces unread messages and blocked escalations via two fast SQL queries.

**Tech Stack:** TypeScript, Vitest, Zod, node-sqlite3-wasm, MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-10-main-session-orchestrator-design.md`

---

## Chunk 1: DB Layer — Self-Unblock Transition and blocked_by Clearing

### Task 1: Add `blocked → in_progress` transition to VALID_TRANSITIONS

**Files:**
- Modify: `src/mcp-server/db.ts:232-236`
- Test: `src/mcp-server/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing test for blocked → in_progress**

Add to `db.test.ts` inside the `describe("tasks")` block, after the existing transition tests (after line 341):

```typescript
it("allows blocked → in_progress transition (self-unblock after escalation)", () => {
  const team = db.createTeam("Test");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");
  db.updateTask(task.id, "blocked");
  const resumed = db.updateTask(task.id, "in_progress");
  expect(resumed.status).toBe("in_progress");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "allows blocked → in_progress"`
Expected: FAIL with "Invalid transition: blocked → in_progress"

- [ ] **Step 3: Add `in_progress` to the blocked transitions**

In `src/mcp-server/db.ts`, line 234, change:
```typescript
blocked: ["pending"], // auto-unblock only, not direct
```
to:
```typescript
blocked: ["pending", "in_progress"], // auto-unblock or self-unblock after escalation
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "allows blocked → in_progress"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: add blocked → in_progress transition for self-unblock"
```

### Task 2: Clear `blocked_by` when self-blocking from in_progress

When a teammate transitions `in_progress → blocked` (escalation), the original dependency blockers are no longer relevant. Clear `blocked_by` so the hook query `(blocked_by IS NULL OR blocked_by = '[]')` reliably detects escalation-blocked tasks.

**Files:**
- Modify: `src/mcp-server/db.ts:262-268` (the else branch in updateTask)
- Test: `src/mcp-server/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing test for blocked_by clearing**

Add to `db.test.ts` inside `describe("tasks")`:

```typescript
it("clears blocked_by when transitioning in_progress → blocked (escalation)", () => {
  const team = db.createTeam("Test");
  const t1 = db.createTask(team.id, "Setup DB");
  const t2 = db.createTask(team.id, "Build API", undefined, undefined, [t1.id]);
  // Complete the blocker so t2 auto-unblocks
  db.claimTask(t1.id, "teammate-1");
  db.updateTask(t1.id, "completed", "Done");
  // t2 is now pending with blocked_by still set
  db.claimTask(t2.id, "teammate-2");
  // Escalation block
  db.updateTask(t2.id, "blocked");
  const blocked = db.getTask(t2.id)!;
  expect(blocked.blocked_by).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "clears blocked_by when transitioning"`
Expected: FAIL — `blocked_by` is still `[t1.id]`

- [ ] **Step 3: Clear blocked_by on in_progress → blocked transition**

In `src/mcp-server/db.ts`, in the `updateTask` method, replace the else branch at lines 266-268:

```typescript
} else {
  this.db.run("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?", [effectiveStatus, result ?? null, now, id]);
}
```

with:

```typescript
} else if (effectiveStatus === "blocked" && task.status === "in_progress") {
  // Escalation block: clear blocked_by so hook detects this as escalation, not dependency wait
  this.db.run("UPDATE tasks SET status = ?, result = ?, blocked_by = NULL, updated_at = ? WHERE id = ?", [effectiveStatus, result ?? null, now, id]);
} else {
  this.db.run("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?", [effectiveStatus, result ?? null, now, id]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "clears blocked_by when transitioning"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: clear blocked_by on escalation block (in_progress → blocked)"
```

### Task 3: Add `getLeadId` helper to TeamDB

**Files:**
- Modify: `src/mcp-server/db.ts` (after `getMembers` at line 131)
- Test: `src/mcp-server/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `db.test.ts` inside `describe("members")`:

```typescript
it("getLeadId returns the lead agent_id", () => {
  const team = db.createTeam("Test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  expect(db.getLeadId(team.id)).toBe("lead");
});

it("getLeadId returns null when no lead exists", () => {
  const team = db.createTeam("Test");
  db.addMember(team.id, "teammate-1", "teammate");
  expect(db.getLeadId(team.id)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "getLeadId"`
Expected: FAIL with "db.getLeadId is not a function"

- [ ] **Step 3: Add the getLeadId method**

In `src/mcp-server/db.ts`, after the `getMembers` method (after line 131), add:

```typescript
getLeadId(teamId: string): string | null {
  const row = this.db.get(
    "SELECT agent_id FROM members WHERE team_id = ? AND role = ?",
    [teamId, "lead"]
  ) as { agent_id: string } | undefined;
  return row?.agent_id ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "getLeadId"`
Expected: PASS

- [ ] **Step 5: Run all DB tests**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: add getLeadId helper to TeamDB"
```

---

## Chunk 2: Tool Layer — update_task Schema and CC Messaging

### Task 4: Expand `update_task` Zod schema to accept `in_progress`

**Files:**
- Modify: `src/mcp-server/tools/tasks.ts:46,55`
- Test: `src/mcp-server/__tests__/tools-tasks.test.ts`

- [ ] **Step 1: Write the failing test for update_task with in_progress**

Add to `tools-tasks.test.ts` inside `describe("Task Board Tools")`:

```typescript
it("update_task with in_progress self-unblocks from blocked", async () => {
  const team = db.createTeam("Test");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");
  db.updateTask(task.id, "blocked");
  const result = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "in_progress" } });
  expect(result.isError).toBeFalsy();
  const content = JSON.parse((result.content as any)[0].text);
  expect(content.status).toBe("in_progress");
});

it("update_task rejects in_progress from in_progress (no-op transition)", async () => {
  const team = db.createTeam("Test");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");
  const result = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "in_progress" } });
  expect(result.isError).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts -t "update_task with in_progress"`
Expected: FAIL — Zod validation rejects "in_progress" (not in enum)

- [ ] **Step 3: Update the Zod schema and actionType**

In `src/mcp-server/tools/tasks.ts`:

Line 46 — change:
```typescript
status: z.enum(["completed", "blocked"]),
```
to:
```typescript
status: z.enum(["completed", "blocked", "in_progress"]),
```

Line 55 — change:
```typescript
const actionType = status === "completed" ? "task_complete" : "task_block";
```
to:
```typescript
const actionType = status === "completed" ? "task_complete" : status === "in_progress" ? "task_resume" : "task_block";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/tools/tasks.ts src/mcp-server/__tests__/tools-tasks.test.ts
git commit -m "feat: expand update_task to accept in_progress status for self-unblock"
```

### Task 5: Add CC logic to send_message for teammate-to-teammate messages

**Files:**
- Modify: `src/mcp-server/tools/messaging.ts:9-18`
- Test: `src/mcp-server/__tests__/tools-messaging.test.ts`

- [ ] **Step 1: Write the failing tests for CC behavior**

Add to `tools-messaging.test.ts` inside `describe("Messaging Tools")`:

```typescript
it("teammate-to-teammate message CCs the lead", async () => {
  const team = db.createTeam("Test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  db.addMember(team.id, "teammate-2", "teammate");
  await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "teammate-1", to: "teammate-2", content: "I changed the API" } });

  // Lead should get a CC
  const leadMsgs = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "lead" } });
  const parsed = JSON.parse((leadMsgs.content as any)[0].text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].content).toContain("[CC to teammate-2]");
  expect(parsed[0].content).toContain("I changed the API");

  // Original recipient still gets the message
  const t2Msgs = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-2" } });
  const t2Parsed = JSON.parse((t2Msgs.content as any)[0].text);
  expect(t2Parsed).toHaveLength(1);
  expect(t2Parsed[0].content).toBe("I changed the API");
});

it("lead-to-teammate message does not CC", async () => {
  const team = db.createTeam("Test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "teammate-1", content: "Do X" } });

  // Lead should have no unread (they sent it)
  const leadMsgs = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "lead" } });
  const parsed = JSON.parse((leadMsgs.content as any)[0].text);
  expect(parsed).toHaveLength(0);
});

it("teammate-to-lead message does not CC", async () => {
  const team = db.createTeam("Test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "teammate-1", to: "lead", content: "Question" } });

  // Lead gets exactly one message (the original, not a CC duplicate)
  const leadMsgs = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "lead" } });
  const parsed = JSON.parse((leadMsgs.content as any)[0].text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].content).toBe("Question");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/tools-messaging.test.ts -t "teammate-to-teammate message CCs the lead"`
Expected: FAIL — lead gets 0 messages instead of 1

- [ ] **Step 3: Add CC logic to send_message handler**

In `src/mcp-server/tools/messaging.ts`, replace the `send_message` handler (lines 7-19):

```typescript
server.tool("send_message", "Send a direct message to a teammate",
  { team_id: z.string(), from: agentIdSchema, to: agentIdSchema, content: z.string().max(10000) },
  async ({ team_id, from, to, content }) => {
    try {
      db.getActiveTeam(team_id);
      const msg = db.sendMessage(team_id, from, to, content);
      db.logAction(team_id, from, "message_send");

      // CC lead on teammate-to-teammate messages (best-effort)
      try {
        const members = db.getMembers(team_id);
        const fromMember = members.find(m => m.agent_id === from);
        const toMember = members.find(m => m.agent_id === to);
        const leadId = db.getLeadId(team_id);
        if (fromMember?.role === "teammate" && toMember?.role === "teammate" && leadId) {
          db.sendMessage(team_id, from, leadId, `[CC to ${to}]: ${content}`);
        }
      } catch { /* CC is best-effort — original message already delivered */ }

      return { content: [{ type: "text", text: JSON.stringify(msg) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  }
);
```

- [ ] **Step 4: Run all messaging tests**

Run: `npx vitest run src/mcp-server/__tests__/tools-messaging.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/tools/messaging.ts src/mcp-server/__tests__/tools-messaging.test.ts
git commit -m "feat: CC lead on teammate-to-teammate messages (best-effort)"
```

---

## Chunk 3: Hook Rewrite — Actionable Notifications

### Task 6: Rewrite the nudge-messages hook

The existing hook prints a generic reminder whenever active teams exist. Replace with two focused SQL queries: unread count for the lead and blocked-without-blockers count. Silent when nothing is actionable.

**Files:**
- Rewrite: `src/hooks/nudge-messages.ts`
- Rewrite tests: `src/hooks/__tests__/hooks.test.ts` (the `describe("nudge-messages")` block)

- [ ] **Step 1: Write the new hook tests**

Replace the `describe("nudge-messages")` block in `src/hooks/__tests__/hooks.test.ts` (lines 53-79) with:

```typescript
describe("nudge-messages", () => {
  it("outputs nothing when no DB exists", () => {
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toBe("");
  });

  it("outputs nothing when no active teams", () => {
    const dbDir = join(tmpDir, ".copilot-teams");
    mkdirSync(dbDir);
    const db = new TeamDB(join(dbDir, "teams.db"));
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    db.close();
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toBe("");
  });

  it("outputs nothing when active team has no actionable items", () => {
    const dbDir = join(tmpDir, ".copilot-teams");
    mkdirSync(dbDir);
    const db = new TeamDB(join(dbDir, "teams.db"));
    db.createTeam("Test");
    db.close();
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toBe("");
  });

  it("shows unread message count for the lead", () => {
    const dbDir = join(tmpDir, ".copilot-teams");
    mkdirSync(dbDir);
    const db = new TeamDB(join(dbDir, "teams.db"));
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "teammate-1", "lead", "Help?");
    db.sendMessage(team.id, "teammate-1", "lead", "Stuck on X");
    db.close();
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toContain("2 unread");
    expect(output).toContain("monitor_teammates");
  });

  it("shows blocked task count for escalation", () => {
    const dbDir = join(tmpDir, ".copilot-teams");
    mkdirSync(dbDir);
    const db = new TeamDB(join(dbDir, "teams.db"));
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "blocked");
    db.close();
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toContain("1 blocked");
    expect(output).toContain("monitor_teammates");
  });

  it("shows combined summary when both unread and blocked", () => {
    const dbDir = join(tmpDir, ".copilot-teams");
    mkdirSync(dbDir);
    const db = new TeamDB(join(dbDir, "teams.db"));
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "teammate-1", "lead", "Question");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "blocked");
    db.close();
    const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
    expect(output).toContain("1 unread");
    expect(output).toContain("1 blocked");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/hooks.test.ts -t "nudge-messages"`
Expected: Multiple failures — old hook outputs generic reminder instead of structured summary

- [ ] **Step 3: Rewrite the nudge-messages hook**

Replace `src/hooks/nudge-messages.ts` entirely:

```typescript
import { Database } from "node-sqlite3-wasm";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath);

    const teams = db.all("SELECT id FROM teams WHERE status = 'active'") as Array<{ id: string }>;

    for (const team of teams) {
      const parts: string[] = [];

      // Check unread messages for the lead
      const leadRow = db.get(
        "SELECT agent_id FROM members WHERE team_id = ? AND role = 'lead'",
        [team.id]
      ) as { agent_id: string } | undefined;

      if (leadRow) {
        const unreadRow = db.get(
          "SELECT COUNT(*) as count FROM messages WHERE team_id = ? AND to_agent = ? AND read = 0",
          [team.id, leadRow.agent_id]
        ) as { count: number };
        if (unreadRow.count > 0) {
          parts.push(`${unreadRow.count} unread message${unreadRow.count > 1 ? "s" : ""}`);
        }
      }

      // Check blocked tasks without dependency blockers (escalations)
      const blockedRow = db.get(
        "SELECT COUNT(*) as count FROM tasks WHERE team_id = ? AND status = 'blocked' AND (blocked_by IS NULL OR blocked_by = '[]')",
        [team.id]
      ) as { count: number };
      if (blockedRow.count > 0) {
        parts.push(`${blockedRow.count} blocked task${blockedRow.count > 1 ? "s" : ""} needing input`);
      }

      if (parts.length > 0) {
        console.log(`[agent-teams] Team ${team.id}: ${parts.join(", ")} — use monitor_teammates for details`);
      }
    }

    db.close();
  } catch (e) { console.error(e); }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/hooks.test.ts -t "nudge-messages"`
Expected: All pass

- [ ] **Step 5: Run all hook tests**

Run: `npx vitest run src/hooks/__tests__/hooks.test.ts`
Expected: All pass (both check-active-teams and nudge-messages)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/nudge-messages.ts src/hooks/__tests__/hooks.test.ts
git commit -m "feat: rewrite nudge-messages hook with actionable notifications"
```

---

## Chunk 4: Agent and Skill Markdown Updates

### Task 7: Rewrite `team-start/SKILL.md` for inline orchestration

**Files:**
- Rewrite: `skills/team-start/SKILL.md`

- [ ] **Step 1: Rewrite the skill file**

Replace `skills/team-start/SKILL.md` entirely:

```markdown
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

- [ ] **Step 2: Commit**

```bash
git add skills/team-start/SKILL.md
git commit -m "feat: rewrite team-start skill for inline orchestration"
```

### Task 8: Add deprecation notice to `team-lead.agent.md`

**Files:**
- Modify: `agents/team-lead.agent.md`

- [ ] **Step 1: Add deprecation notice after frontmatter**

After the closing `---` of the frontmatter (line 13), before the existing content, add:

```markdown

> **DEPRECATED**: The main session now serves as the team lead via the `/team-start` skill. This agent file is preserved as a fallback for non-interactive/CI scenarios where a sub-agent lead is appropriate. For normal usage, run `/team-start` directly.

```

- [ ] **Step 2: Commit**

```bash
git add agents/team-lead.agent.md
git commit -m "chore: add deprecation notice to team-lead agent"
```

### Task 9: Update `teammate.agent.md` with peer communication and escalation

**Files:**
- Modify: `agents/teammate.agent.md`

- [ ] **Step 1: Add four new sections before the Rules section**

In `agents/teammate.agent.md`, before `## Rules` (line 56), add:

```markdown
## Teammate Discovery

After registering, call `copilot-agent-teams/team_status` to see other teammates and their assigned tasks. Call `copilot-agent-teams/list_tasks` for detailed task descriptions. Re-check after completing each task to discover newly spawned teammates.

## Peer Communication

When your work affects another teammate's files or APIs, message them directly via `copilot-agent-teams/send_message`. Use `copilot-agent-teams/broadcast` for team-wide announcements (e.g., "I changed the shared config format"). The lead automatically receives a CC of direct peer messages.

## Escalation

If you have a question you can't resolve from context:
1. Send the question to the lead via `copilot-agent-teams/send_message`
2. Set your task to blocked via `copilot-agent-teams/update_task` with status `blocked`
3. Wait for a `[PRIORITY]` message with the answer
4. Resume work by calling `copilot-agent-teams/update_task` with status `in_progress`

## Handling Peer Messages

When you receive a message from another teammate, treat it as informational context. Adjust your approach if relevant. No need to acknowledge unless a response is warranted.

```

- [ ] **Step 2: Commit**

```bash
git add agents/teammate.agent.md
git commit -m "feat: add peer communication, escalation, and discovery to teammate agent"
```

---

## Chunk 5: Verification, Build, and Cleanup

### Task 10: Run full test suite and typecheck

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Fix any failures**

If typecheck or tests fail, diagnose and fix. Re-run until green.

- [ ] **Step 4: Rebuild dist**

Run: `npm run build`
Expected: Clean build, `dist/` updated

- [ ] **Step 5: Commit the dist rebuild**

```bash
git add dist/
git commit -m "chore: rebuild dist with orchestrator changes"
```

### Task 11: Final verification

- [ ] **Step 1: Run tests one more time to confirm dist doesn't break anything**

Run: `npm test && npm run typecheck`
Expected: All green

- [ ] **Step 2: Review the full diff**

Run: `git log --oneline main..HEAD` to verify all commits are clean and focused.
