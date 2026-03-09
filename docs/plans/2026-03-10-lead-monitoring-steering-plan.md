# Lead Monitoring & Steering — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the lead agent monitor teammate progress via .md files and steer them with priority directives when they go off track.

**Architecture:** Two new MCP tools (`monitor_teammates`, `steer_teammate`) backed by a new `countUnread` DB method and a new `steerTeammate` atomic DB method. Progress reporting is file-based (.md), not SQL. Agent prompts updated for progress writing and priority message handling.

**Tech Stack:** TypeScript, node-sqlite3-wasm, Zod, Vitest, @modelcontextprotocol/sdk, Node.js `fs`/`path`

---

### Task 1: Add `countUnread` DB Method

**Files:**
- Modify: `src/mcp-server/db.ts:448` (after `getMessages`, before Audit Log section)
- Test: `src/mcp-server/__tests__/db.test.ts`

**Step 1: Write the failing test**

Add to `src/mcp-server/__tests__/db.test.ts` inside the existing `describe("TeamDB")` block:

```typescript
it("countUnread returns unread message count without consuming", () => {
  const team = db.createTeam("count test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");

  db.sendMessage(team.id, "lead", "teammate-1", "msg 1");
  db.sendMessage(team.id, "lead", "teammate-1", "msg 2");
  db.sendMessage(team.id, "lead", "teammate-1", "msg 3");

  expect(db.countUnread(team.id, "teammate-1")).toBe(3);
  expect(db.countUnread(team.id, "lead")).toBe(0);

  // Consuming messages should NOT affect a prior countUnread result,
  // but a subsequent countUnread should reflect the change
  db.getMessages(team.id, "teammate-1");
  expect(db.countUnread(team.id, "teammate-1")).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "countUnread"`
Expected: FAIL — `db.countUnread is not a function`

**Step 3: Write minimal implementation**

Add to `src/mcp-server/db.ts` after the `getMessages` method (around line 448):

```typescript
countUnread(teamId: string, agentId: string): number {
  const row = this.db.get(
    "SELECT COUNT(*) as count FROM messages WHERE team_id = ? AND to_agent = ? AND read = 0",
    [teamId, agentId]
  ) as { count: number } | undefined;
  return row?.count ?? 0;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "countUnread"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: add countUnread DB method for non-consuming message count"
```

---

### Task 2: Add `steerTeammate` Atomic DB Method

**Files:**
- Modify: `src/mcp-server/db.ts` (after `rejectTask`, around line 353)
- Test: `src/mcp-server/__tests__/db.test.ts`

**Step 1: Write the failing tests**

Add to `src/mcp-server/__tests__/db.test.ts`:

```typescript
it("steerTeammate sends priority message to teammate", () => {
  const team = db.createTeam("steer test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");

  db.steerTeammate(team.id, "lead", "teammate-1", "Stop, use approach Y instead");

  const msgs = db.getMessages(team.id, "teammate-1");
  expect(msgs).toHaveLength(1);
  expect(msgs[0].content).toBe("[PRIORITY] Stop, use approach Y instead");
  expect(msgs[0].from_agent).toBe("lead");
});

it("steerTeammate with reassign resets task to pending", () => {
  const team = db.createTeam("steer reassign test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");

  db.steerTeammate(team.id, "lead", "teammate-1", "Task is too complex, reassigning", true);

  const msgs = db.getMessages(team.id, "teammate-1");
  expect(msgs).toHaveLength(1);
  expect(msgs[0].content).toContain("[PRIORITY]");

  const updated = db.getTask(task.id);
  expect(updated!.status).toBe("pending");
  expect(updated!.assigned_to).toBeNull();
  expect(updated!.claimed_at).toBeNull();
});

it("steerTeammate rejects non-lead callers", () => {
  const team = db.createTeam("steer auth test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  db.addMember(team.id, "teammate-2", "teammate");

  expect(() => db.steerTeammate(team.id, "teammate-1", "teammate-2", "Do X")).toThrow("Only the team lead");
});

it("steerTeammate rolls back message if reassign fails", () => {
  const team = db.createTeam("steer rollback test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  const task = db.createTask(team.id, "Do thing");
  // Task is pending, not in_progress — reassign should fail

  expect(() => db.steerTeammate(team.id, "lead", "teammate-1", "Reassigning", true)).toThrow();

  // Message should NOT have been sent (transaction rolled back)
  const msgs = db.getMessages(team.id, "teammate-1");
  expect(msgs).toHaveLength(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "steerTeammate"`
Expected: FAIL — `db.steerTeammate is not a function`

**Step 3: Write minimal implementation**

Add to `src/mcp-server/db.ts` after `rejectTask`:

```typescript
steerTeammate(teamId: string, callerAgentId: string, targetAgentId: string, directive: string, reassign?: boolean): void {
  const members = this.getMembers(teamId);
  const caller = members.find(m => m.agent_id === callerAgentId);
  if (!caller || caller.role !== "lead") {
    throw new Error("Only the team lead can steer teammates");
  }

  if (!members.find(m => m.agent_id === targetAgentId)) {
    throw new Error(`Agent '${targetAgentId}' is not a member of team '${teamId}'`);
  }

  this.db.exec("BEGIN IMMEDIATE");
  try {
    const now = Date.now();

    // Send priority message
    this.db.run(
      "INSERT INTO messages (team_id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
      [teamId, callerAgentId, targetAgentId, `[PRIORITY] ${directive}`, now]
    );

    // Optionally reassign the teammate's current in_progress task
    if (reassign) {
      const tasks = this.db.all(
        "SELECT id FROM tasks WHERE team_id = ? AND assigned_to = ? AND status = 'in_progress'",
        [teamId, targetAgentId]
      ) as Array<{ id: number }>;

      if (tasks.length === 0) {
        throw new Error(`No in_progress task found for '${targetAgentId}' to reassign`);
      }

      for (const task of tasks) {
        this.db.run(
          "UPDATE tasks SET status = 'pending', assigned_to = NULL, claimed_at = NULL, updated_at = ? WHERE id = ?",
          [now, task.id]
        );
      }
    }

    // Log the steering action
    this.db.run(
      "INSERT INTO agent_actions (team_id, agent_id, task_id, action_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [teamId, callerAgentId, null, "steer", `Steered ${targetAgentId}: ${directive}`, Date.now()]
    );

    this.db.exec("COMMIT");
  } catch (e) {
    this.db.exec("ROLLBACK");
    throw e;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts -t "steerTeammate"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "feat: add steerTeammate atomic DB method"
```

---

### Task 3: Create `monitor_teammates` MCP Tool

**Files:**
- Create: `src/mcp-server/tools/monitoring.ts`
- Modify: `src/mcp-server/server.ts` (add registration)
- Test: `src/mcp-server/__tests__/tools-monitoring.test.ts`

**Step 1: Write the failing test**

Create `src/mcp-server/__tests__/tools-monitoring.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Monitoring Tools", () => {
  let client: Client;
  let db: TeamDB;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const { server, db: database } = createServer(join(tmpDir, "test.db"));
    db = database;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("monitor_teammates returns teammate status with progress", async () => {
    const team = db.createTeam("monitor test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.logAction(team.id, "teammate-1", "task_claim", task.id);

    // Write a progress file where the tool will look for it
    const progressDir = join(tmpDir, ".copilot-teams", "progress", team.id);
    mkdirSync(progressDir, { recursive: true });
    writeFileSync(join(progressDir, "teammate-1.md"), "## 14:30 — Starting\nReading codebase.\n");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content).toHaveLength(1);
    expect(content[0].agent_id).toBe("teammate-1");
    expect(content[0].progress).toContain("Reading codebase");
    expect(content[0].stale).toBe(false);
    expect(content[0].current_task).toBeDefined();
    expect(content[0].current_task.subject).toBe("Do thing");
  });

  it("monitor_teammates handles missing progress file gracefully", async () => {
    const team = db.createTeam("no progress test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].progress).toBeNull();
  });

  it("monitor_teammates flags stale teammates", async () => {
    const team = db.createTeam("stale test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");

    // Use a very short threshold so the file is immediately stale
    const progressDir = join(tmpDir, ".copilot-teams", "progress", team.id);
    mkdirSync(progressDir, { recursive: true });
    writeFileSync(join(progressDir, "teammate-1.md"), "## 14:30 — Starting\nReading codebase.\n");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id, stale_threshold_seconds: 0 }
    });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].stale).toBe(true);
  });

  it("monitor_teammates shows unread message count", async () => {
    const team = db.createTeam("unread test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);

    db.sendMessage(team.id, "lead", "teammate-1", "Check this");
    db.sendMessage(team.id, "lead", "teammate-1", "And this");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].unread_messages).toBe(2);
  });

  it("monitor_teammates excludes the lead from results", async () => {
    const team = db.createTeam("exclude lead test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    const content = JSON.parse((result.content as any)[0].text);
    const agentIds = content.map((c: any) => c.agent_id);
    expect(agentIds).not.toContain("lead");
  });

  it("monitor_teammates uses worktree_path=null fallback for non-tmux agents", async () => {
    const team = db.createTeam("no worktree test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate"); // no worktree_path

    // The tool should not crash — it should return progress: null for this agent
    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].progress).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp-server/__tests__/tools-monitoring.test.ts`
Expected: FAIL — module not found or tool not registered

**Step 3: Write implementation**

Create `src/mcp-server/tools/monitoring.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { statSync, readFileSync } from "fs";
import { join, resolve } from "path";
import type { TeamDB } from "../db.js";

interface TeammateStatus {
  agent_id: string;
  current_task: { id: number; subject: string; status: string; elapsed_ms: number } | null;
  progress: string | null;
  stale: boolean;
  stale_seconds: number | null;
  last_activity: { action_type: string; created_at: number } | null;
  unread_messages: number;
}

function readProgressFile(basePath: string | null, teamId: string, agentId: string, lines: number): { content: string | null; mtimeMs: number | null } {
  if (!basePath) return { content: null, mtimeMs: null };

  const progressPath = resolve(join(basePath, ".copilot-teams", "progress", teamId, `${agentId}.md`));
  const expectedBase = resolve(join(basePath, ".copilot-teams", "progress", teamId));

  // Path boundary check
  if (!progressPath.startsWith(expectedBase)) {
    return { content: null, mtimeMs: null };
  }

  try {
    const stat = statSync(progressPath);
    const content = readFileSync(progressPath, "utf-8");
    const allLines = content.split("\n");
    const tail = allLines.slice(-lines).join("\n").trim();
    return { content: tail || null, mtimeMs: stat.mtimeMs };
  } catch {
    return { content: null, mtimeMs: null };
  }
}

export function registerMonitoringTools(server: McpServer, db: TeamDB): void {
  server.tool("monitor_teammates", "Monitor all teammates — shows progress, task state, staleness, and unread messages",
    {
      team_id: z.string(),
      stale_threshold_seconds: z.number().int().positive().optional().default(120),
      progress_lines: z.number().int().positive().optional().default(20),
    },
    async ({ team_id, stale_threshold_seconds, progress_lines }) => {
      try {
        db.getActiveTeam(team_id);
        const members = db.getMembers(team_id);
        const teammates = members.filter(m => m.role === "teammate");
        const lastActivity = db.getLastActivity(team_id);
        const tasksWithDuration = db.getTasksWithDuration(team_id);
        const now = Date.now();
        const thresholdMs = stale_threshold_seconds * 1000;

        const results: TeammateStatus[] = [];

        for (const teammate of teammates) {
          // Find current in_progress task for this teammate
          const currentTask = tasksWithDuration.find(
            t => t.assigned_to === teammate.agent_id && t.status === "in_progress"
          );

          // Read progress file
          const { content, mtimeMs } = readProgressFile(
            teammate.worktree_path, team_id, teammate.agent_id, progress_lines
          );

          // Staleness: based on file mtime if available, else task claim time
          let stale = false;
          let staleSeconds: number | null = null;
          if (mtimeMs !== null) {
            const elapsed = now - mtimeMs;
            stale = elapsed > thresholdMs;
            staleSeconds = Math.round(elapsed / 1000);
          } else if (currentTask?.claimed_at) {
            // No progress file yet — check if task has been running long enough to be suspicious
            const elapsed = now - currentTask.claimed_at;
            stale = elapsed > thresholdMs;
            staleSeconds = Math.round(elapsed / 1000);
          }

          results.push({
            agent_id: teammate.agent_id,
            current_task: currentTask ? {
              id: currentTask.id,
              subject: currentTask.subject,
              status: currentTask.status,
              elapsed_ms: currentTask.duration_ms ?? 0,
            } : null,
            progress: content,
            stale,
            stale_seconds: staleSeconds,
            last_activity: lastActivity[teammate.agent_id] ?? null,
            unread_messages: db.countUnread(team_id, teammate.agent_id),
          });
        }

        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("steer_teammate", "Send a priority directive to a teammate, optionally reassigning their task",
    {
      team_id: z.string(),
      agent_id: z.string().regex(/^[a-z0-9-]+$/).max(50),
      directive: z.string().max(10000).describe("The steering message — explain what to do differently"),
      reassign: z.boolean().optional().default(false).describe("If true, resets the teammate's in_progress task(s) to pending"),
    },
    async ({ team_id, agent_id, directive, reassign }) => {
      try {
        db.getActiveTeam(team_id);
        db.steerTeammate(team_id, "lead", agent_id, directive, reassign);
        const action = reassign ? "steered and reassigned" : "steered";
        return { content: [{ type: "text", text: JSON.stringify({ status: action, agent_id, directive }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );
}
```

**Step 4: Register in server.ts**

Modify `src/mcp-server/server.ts` to add the import and registration:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerMonitoringTools } from "./tools/monitoring.js";

export function createServer(dbPath: string): { server: McpServer; db: TeamDB } {
  const server = new McpServer({ name: "copilot-agent-teams", version: "0.1.0" });
  const db = new TeamDB(dbPath);
  registerTeamTools(server, db);
  registerTaskTools(server, db);
  registerMessagingTools(server, db);
  registerMonitoringTools(server, db);
  return { server, db };
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-monitoring.test.ts`
Expected: PASS (all 6 tests)

**Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 7: Commit**

```bash
git add src/mcp-server/tools/monitoring.ts src/mcp-server/server.ts src/mcp-server/__tests__/tools-monitoring.test.ts
git commit -m "feat: add monitor_teammates and steer_teammate MCP tools"
```

---

### Task 4: Add `steer_teammate` MCP Tool Tests

The `steer_teammate` tool was registered in Task 3 but needs its own test coverage.

**Files:**
- Modify: `src/mcp-server/__tests__/tools-monitoring.test.ts`

**Step 1: Write tests**

Add to the existing `describe("Monitoring Tools")` block:

```typescript
it("steer_teammate sends priority directive", async () => {
  const team = db.createTeam("steer tool test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");

  const result = await client.callTool({
    name: "steer_teammate",
    arguments: { team_id: team.id, agent_id: "teammate-1", directive: "Use approach Y instead" }
  });
  expect(result.isError).toBeFalsy();
  const content = JSON.parse((result.content as any)[0].text);
  expect(content.status).toBe("steered");

  // Verify message was sent
  const msgs = db.getMessages(team.id, "teammate-1");
  expect(msgs).toHaveLength(1);
  expect(msgs[0].content).toBe("[PRIORITY] Use approach Y instead");
});

it("steer_teammate with reassign resets task", async () => {
  const team = db.createTeam("steer reassign tool test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");
  const task = db.createTask(team.id, "Do thing");
  db.claimTask(task.id, "teammate-1");

  const result = await client.callTool({
    name: "steer_teammate",
    arguments: { team_id: team.id, agent_id: "teammate-1", directive: "Reassigning", reassign: true }
  });
  expect(result.isError).toBeFalsy();
  const content = JSON.parse((result.content as any)[0].text);
  expect(content.status).toBe("steered and reassigned");

  const updated = db.getTask(task.id);
  expect(updated!.status).toBe("pending");
});

it("steer_teammate logs audit action", async () => {
  const team = db.createTeam("steer audit test");
  db.addMember(team.id, "lead", "lead");
  db.addMember(team.id, "teammate-1", "teammate");

  await client.callTool({
    name: "steer_teammate",
    arguments: { team_id: team.id, agent_id: "teammate-1", directive: "Fix this" }
  });

  const actions = db.getAuditLog(team.id, { action_type: "steer" });
  expect(actions).toHaveLength(1);
  expect(actions[0].detail).toContain("teammate-1");
});

it("steer_teammate returns error for non-existent team", async () => {
  const result = await client.callTool({
    name: "steer_teammate",
    arguments: { team_id: "nonexistent", agent_id: "teammate-1", directive: "Fix" }
  });
  expect(result.isError).toBe(true);
});
```

**Step 2: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/tools-monitoring.test.ts`
Expected: PASS (all 10 tests)

**Step 3: Commit**

```bash
git add src/mcp-server/__tests__/tools-monitoring.test.ts
git commit -m "test: add steer_teammate MCP tool tests"
```

---

### Task 5: Update Agent Prompts

**Files:**
- Modify: `agents/teammate.agent.md`
- Modify: `agents/team-lead.agent.md`

**Step 1: Update teammate prompt**

Replace the full content of `agents/teammate.agent.md` with:

```markdown
---
name: teammate
description: Team member that claims and completes tasks from the shared board. Spawned by the team lead.
model: claude-sonnet-4-6
tools:
  - copilot-agent-teams/*
  - shell
  - view
  - edit
  - grep
  - glob
  - agent
---

You are a teammate working on tasks from a shared task board.

## Workflow

1. Call `copilot-agent-teams/register_teammate` with your `team_id` and `agent_id`
2. Call `copilot-agent-teams/list_tasks` to see available work
3. Call `copilot-agent-teams/claim_task` on an assigned or unassigned task
4. Do the work using code tools (view, edit, shell, grep, glob)
5. Call `copilot-agent-teams/update_task` with status `completed` and a concise `result`
6. Call `copilot-agent-teams/get_messages` — check for lead instructions
7. Call `copilot-agent-teams/list_tasks` — pick up next task or message the lead if done

## Progress Reporting

After each meaningful step (file edit, test run, design decision, dead end), append a timestamped entry to your progress file:

**Path:** `.copilot-teams/progress/{team_id}/{agent_id}.md`

**Format:**
```
## HH:MM — Brief summary
1-3 lines: what you did, what you found, what you're doing next.
```

**Example:**
```
## 14:33 — Designing webhook handler
Stripe sends events to /webhooks/stripe. Need to verify signatures.
Following the pattern in src/routes/oauth-callback.ts.

## 14:37 — Tests failing
stripe.webhooks.constructEvent throws — mock missing signature header.
Adding test helper in __tests__/helpers/stripe.ts.
```

Keep entries concise. The lead monitors this file to track your progress.

## Priority Messages

After each major step, check `copilot-agent-teams/get_messages`. If you receive a message prefixed with `[PRIORITY]`, **stop your current approach immediately** and follow the directive before continuing your work.

## Rules

- Always register first before doing anything else
- Always provide a `result` summary when completing — the lead relies on these
- Check messages after each task — the lead may redirect you
- If stuck, message the lead via `copilot-agent-teams/send_message`
- You may spawn sub-agents via `agent` for complex subtasks within your assigned task
```

**Step 2: Update team-lead prompt**

Replace the full content of `agents/team-lead.agent.md` with:

```markdown
---
name: team-lead
description: Orchestrates multi-agent teams for complex tasks. Decomposes goals into parallel subtasks, spawns teammates, and coordinates via shared task board and messaging.
model: claude-sonnet-4-6
tools:
  - copilot-agent-teams/*
  - shell
  - view
  - edit
  - grep
  - glob
  - agent
---

You are a team lead coordinating multiple agents to accomplish a complex goal.

## Workflow

1. Read the codebase to understand context (view, grep, glob)
2. If a team hasn't been created yet, call `copilot-agent-teams/create_team` with the goal
3. Decompose into independent, parallelizable tasks via `copilot-agent-teams/create_task`
   - Set `blocked_by` for tasks with dependencies
   - Set `assigned_to` to pre-assign tasks to specific teammates
   - Include exact file paths and expected outcomes in descriptions
4. Spawn teammates (see below)
5. Monitor and steer (see below)
6. Once all tasks complete, read results and synthesize a summary
7. Call `copilot-agent-teams/stop_team`

## Spawning Teammates

Try tmux first (parallel panes with isolated worktrees):

```bash
bash scripts/spawn-teammate.sh <team_id> <agent_id> "<task_description>" [model]
```

Each teammate gets its own git worktree and branch (`team/<team_id>/<agent_id>`), eliminating file conflicts between concurrent agents.

If output is `NOT_IN_TMUX`, fall back to the `agent` tool with prompt:
> You are `<agent_id>` on team `<team_id>`. Register with register_teammate, then list_tasks, claim your work, and complete it. Task context: `<task_description>`

Spawn one teammate per independent task group. Typical: 2-4 teammates.

## Monitoring & Steering

After spawning teammates, enter a monitoring loop:

1. Call `copilot-agent-teams/monitor_teammates` every 30-60 seconds
2. For each teammate, check:
   - **Progress content** — is the approach correct? Are they on the right track?
   - **Staleness** — if flagged stale, the teammate may be stuck or spinning
   - **Unread messages** — if high, the teammate may not be checking messages
3. If a teammate needs a nudge: `copilot-agent-teams/steer_teammate` with a directive
4. If a teammate is truly off track: `copilot-agent-teams/steer_teammate` with `reassign: true`

**Use `monitor_teammates` for detailed progress checks.** Use `team_status` for a quick numeric overview (task counts, completion percentage).

## Task Decomposition

- Minimize file conflicts — assign different modules/files to different teammates
- Make tasks as independent as possible
- Each task should be completable in a single focused session
```

**Step 3: Run full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add agents/teammate.agent.md agents/team-lead.agent.md
git commit -m "docs: update agent prompts with progress reporting and monitoring instructions"
```

---

### Task 6: Build & Final Verification

**Files:**
- Modify: `dist/mcp-server/index.js` (rebuilt)

**Step 1: Build the bundle**

Run: `npm run build`
Expected: Success, `dist/mcp-server/index.js` updated

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Commit dist**

```bash
git add dist/
git commit -m "chore: rebuild dist with monitoring tools"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/mcp-server/db.ts` | Add `countUnread()`, `steerTeammate()` methods |
| `src/mcp-server/tools/monitoring.ts` | New file — `monitor_teammates`, `steer_teammate` tools |
| `src/mcp-server/server.ts` | Register `registerMonitoringTools` |
| `src/mcp-server/__tests__/db.test.ts` | Tests for `countUnread`, `steerTeammate` |
| `src/mcp-server/__tests__/tools-monitoring.test.ts` | New file — 10 tests for monitoring tools |
| `agents/teammate.agent.md` | Progress reporting + priority message instructions |
| `agents/team-lead.agent.md` | Monitoring loop + steering instructions |
| `dist/mcp-server/index.js` | Rebuilt |

**Total new tests:** ~14 (4 DB + 10 MCP tool)
**Total new MCP tools:** 2 (`monitor_teammates`, `steer_teammate`)
**Total new DB methods:** 2 (`countUnread`, `steerTeammate`)
