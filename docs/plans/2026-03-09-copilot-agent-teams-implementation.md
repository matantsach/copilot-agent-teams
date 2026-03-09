# Copilot Agent Teams — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Copilot CLI plugin that adds multi-agent team coordination via an MCP server backed by SQLite.

**Architecture:** Node.js MCP server (stdio transport) exposes team, task, and messaging tools. SQLite stores all state in `.copilot-teams/teams.db`. Agent markdown files and skill markdown files are thin wrappers calling MCP tools. Hooks handle session resume and message polling nudges.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk v1.x, better-sqlite3, zod v3, vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize package.json**

```json
{
  "name": "copilot-agent-teams",
  "version": "0.1.0",
  "description": "Multi-agent team coordination plugin for GitHub Copilot CLI",
  "type": "module",
  "main": "dist/mcp-server/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/mcp-server/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT",
  "engines": {
    "node": ">=20"
  }
}
```

Run: `cd /Users/matantsach/mtsach/projects/copilot-agent-teams`

Write `package.json` with the above content.

**Step 2: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk zod better-sqlite3
npm install -D typescript @types/better-sqlite3 @types/node tsx vitest
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.copilot-teams/
*.db
```

**Step 5: Create directory structure**

Run:
```bash
mkdir -p src/mcp-server/tools
mkdir -p agents
mkdir -p skills/team-start skills/team-status skills/team-stop
```

**Step 6: Verify build setup**

Run: `npx tsc --noEmit`
Expected: No errors (no source files yet, clean exit)

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore
git commit -m "chore: scaffold project with TypeScript, MCP SDK, and SQLite deps"
```

---

### Task 2: Plugin Manifest Files

**Files:**
- Create: `plugin.json`
- Create: `.mcp.json`
- Create: `hooks.json`

**Step 1: Create plugin.json**

```json
{
  "name": "copilot-agent-teams",
  "description": "Multi-agent team coordination — shared task boards, messaging, and team orchestration",
  "version": "0.1.0",
  "agents": "agents/",
  "skills": ["skills/"],
  "hooks": "hooks.json",
  "mcpServers": ".mcp.json"
}
```

**Step 2: Create .mcp.json**

```json
{
  "mcpServers": {
    "agent-teams": {
      "command": "node",
      "args": ["dist/mcp-server/index.js"],
      "env": {}
    }
  }
}
```

**Step 3: Create hooks.json (empty for now, populated in Task 10)**

```json
{
  "hooks": {}
}
```

**Step 4: Commit**

```bash
git add plugin.json .mcp.json hooks.json
git commit -m "chore: add plugin manifest, MCP server config, and hooks stub"
```

---

### Task 3: Shared Types

**Files:**
- Create: `src/mcp-server/types.ts`

**Step 1: Write types**

```typescript
export type TeamStatus = "active" | "completed" | "stopped";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type MemberRole = "lead" | "teammate";
export type MemberStatus = "active" | "idle" | "finished";

export interface Team {
  id: string;
  goal: string;
  status: TeamStatus;
  config: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: number;
  team_id: string;
  subject: string;
  description: string | null;
  status: TaskStatus;
  assigned_to: string | null;
  blocked_by: number[] | null;
  result: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: number;
  team_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  read: boolean;
  created_at: number;
}

export interface Member {
  team_id: string;
  agent_id: string;
  role: MemberRole;
  status: MemberStatus;
  worktree_path: string | null;
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean exit, no errors

**Step 3: Commit**

```bash
git add src/mcp-server/types.ts
git commit -m "feat: add shared types for teams, tasks, messages, members"
```

---

### Task 4: SQLite Database Layer — Tests

**Files:**
- Create: `src/mcp-server/db.ts` (stub)
- Create: `src/mcp-server/__tests__/db.test.ts`

**Step 1: Write db.ts stub with exports**

```typescript
import Database from "better-sqlite3";
import type { Team, Task, Message, Member } from "./types.js";

export class TeamDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    throw new Error("Not implemented");
  }

  close(): void {
    this.db.close();
  }

  // Team operations
  createTeam(goal: string, config?: Record<string, unknown>): Team {
    throw new Error("Not implemented");
  }
  getTeam(id: string): Team | undefined {
    throw new Error("Not implemented");
  }
  updateTeamStatus(id: string, status: Team["status"]): void {
    throw new Error("Not implemented");
  }

  // Member operations
  addMember(teamId: string, agentId: string, role: Member["role"]): Member {
    throw new Error("Not implemented");
  }
  getMembers(teamId: string): Member[] {
    throw new Error("Not implemented");
  }
  updateMemberStatus(teamId: string, agentId: string, status: Member["status"]): void {
    throw new Error("Not implemented");
  }

  // Task operations
  createTask(teamId: string, subject: string, description?: string, assignedTo?: string, blockedBy?: number[]): Task {
    throw new Error("Not implemented");
  }
  getTask(id: number): Task | undefined {
    throw new Error("Not implemented");
  }
  claimTask(id: number, agentId: string): Task {
    throw new Error("Not implemented");
  }
  updateTask(id: number, status: Task["status"], result?: string): Task {
    throw new Error("Not implemented");
  }
  listTasks(teamId: string, filter?: { status?: Task["status"]; assigned_to?: string }): Task[] {
    throw new Error("Not implemented");
  }

  // Message operations
  sendMessage(teamId: string, from: string, to: string | null, content: string): Message {
    throw new Error("Not implemented");
  }
  getMessages(teamId: string, forAgent: string, since?: number): Message[] {
    throw new Error("Not implemented");
  }
}
```

**Step 2: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("TeamDB", () => {
  let db: TeamDB;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    db = new TeamDB(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  describe("teams", () => {
    it("creates a team and returns it", () => {
      const team = db.createTeam("Build auth system");
      expect(team.id).toBeDefined();
      expect(team.goal).toBe("Build auth system");
      expect(team.status).toBe("active");
    });

    it("retrieves a team by id", () => {
      const created = db.createTeam("Build auth system");
      const retrieved = db.getTeam(created.id);
      expect(retrieved).toEqual(created);
    });

    it("updates team status", () => {
      const team = db.createTeam("Build auth system");
      db.updateTeamStatus(team.id, "completed");
      const updated = db.getTeam(team.id);
      expect(updated?.status).toBe("completed");
    });
  });

  describe("members", () => {
    it("adds a member to a team", () => {
      const team = db.createTeam("Test");
      const member = db.addMember(team.id, "lead", "lead");
      expect(member.agent_id).toBe("lead");
      expect(member.role).toBe("lead");
      expect(member.status).toBe("active");
    });

    it("lists all members of a team", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const members = db.getMembers(team.id);
      expect(members).toHaveLength(2);
    });

    it("updates member status", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.updateMemberStatus(team.id, "lead", "finished");
      const members = db.getMembers(team.id);
      expect(members[0].status).toBe("finished");
    });
  });

  describe("tasks", () => {
    it("creates a task on the board", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Implement login", "Build the login endpoint");
      expect(task.id).toBeDefined();
      expect(task.subject).toBe("Implement login");
      expect(task.status).toBe("pending");
      expect(task.assigned_to).toBeNull();
    });

    it("creates a task with assignment and dependencies", () => {
      const team = db.createTeam("Test");
      const task1 = db.createTask(team.id, "Setup DB");
      const task2 = db.createTask(team.id, "Build API", undefined, "teammate-1", [task1.id]);
      expect(task2.assigned_to).toBe("teammate-1");
      expect(task2.blocked_by).toEqual([task1.id]);
    });

    it("claims an unassigned task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.assigned_to).toBe("teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("throws when claiming an already-assigned task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow();
    });

    it("updates task status with result", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const updated = db.updateTask(task.id, "completed", "Done. Created 3 files.");
      expect(updated.status).toBe("completed");
      expect(updated.result).toBe("Done. Created 3 files.");
    });

    it("lists tasks with filters", () => {
      const team = db.createTeam("Test");
      db.createTask(team.id, "Task A");
      const taskB = db.createTask(team.id, "Task B");
      db.claimTask(taskB.id, "teammate-1");

      const all = db.listTasks(team.id);
      expect(all).toHaveLength(2);

      const pending = db.listTasks(team.id, { status: "pending" });
      expect(pending).toHaveLength(1);
      expect(pending[0].subject).toBe("Task A");

      const byAgent = db.listTasks(team.id, { assigned_to: "teammate-1" });
      expect(byAgent).toHaveLength(1);
      expect(byAgent[0].subject).toBe("Task B");
    });
  });

  describe("messages", () => {
    it("sends a direct message", () => {
      const team = db.createTeam("Test");
      const msg = db.sendMessage(team.id, "lead", "teammate-1", "Start working");
      expect(msg.from_agent).toBe("lead");
      expect(msg.to_agent).toBe("teammate-1");
      expect(msg.content).toBe("Start working");
    });

    it("sends a broadcast (to_agent is null)", () => {
      const team = db.createTeam("Test");
      const msg = db.sendMessage(team.id, "lead", null, "All hands meeting");
      expect(msg.to_agent).toBeNull();
    });

    it("gets unread messages for an agent", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Message 1");
      db.sendMessage(team.id, "lead", "teammate-2", "Not for you");
      db.sendMessage(team.id, "teammate-2", null, "Broadcast");

      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(2); // direct + broadcast
      expect(msgs[0].content).toBe("Message 1");
      expect(msgs[1].content).toBe("Broadcast");
    });

    it("marks messages as read after retrieval", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Hello");

      const first = db.getMessages(team.id, "teammate-1");
      expect(first).toHaveLength(1);

      const second = db.getMessages(team.id, "teammate-1");
      expect(second).toHaveLength(0); // already read
    });

    it("filters messages by since timestamp", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Old message");
      const now = Date.now();
      db.sendMessage(team.id, "lead", "teammate-1", "New message");

      const msgs = db.getMessages(team.id, "teammate-1", now - 1);
      expect(msgs).toHaveLength(2);
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All tests FAIL with "Not implemented"

**Step 4: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "test: add failing tests for TeamDB database layer"
```

---

### Task 5: SQLite Database Layer — Implementation

**Files:**
- Modify: `src/mcp-server/db.ts`

**Step 1: Implement the full database layer**

Replace the stub `db.ts` with:

```typescript
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Team, Task, Message, Member, TeamStatus, TaskStatus, MemberRole, MemberStatus } from "./types.js";

export class TeamDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL REFERENCES teams(id),
        subject TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        assigned_to TEXT,
        blocked_by TEXT,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL REFERENCES teams(id),
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        content TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS members (
        team_id TEXT NOT NULL REFERENCES teams(id),
        agent_id TEXT NOT NULL,
        role TEXT DEFAULT 'teammate',
        status TEXT DEFAULT 'active',
        worktree_path TEXT,
        PRIMARY KEY (team_id, agent_id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Teams ---

  createTeam(goal: string, config?: Record<string, unknown>): Team {
    const id = randomUUID().slice(0, 8);
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO teams (id, goal, status, config, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?)`
    ).run(id, goal, config ? JSON.stringify(config) : null, now, now);
    return this.getTeam(id)!;
  }

  getTeam(id: string): Team | undefined {
    const row = this.db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return {
      ...row,
      config: row.config ? JSON.parse(row.config) : null,
    };
  }

  updateTeamStatus(id: string, status: TeamStatus): void {
    this.db.prepare(
      "UPDATE teams SET status = ?, updated_at = ? WHERE id = ?"
    ).run(status, Date.now(), id);
  }

  // --- Members ---

  addMember(teamId: string, agentId: string, role: MemberRole): Member {
    this.db.prepare(
      `INSERT INTO members (team_id, agent_id, role, status)
       VALUES (?, ?, ?, 'active')`
    ).run(teamId, agentId, role);
    return { team_id: teamId, agent_id: agentId, role, status: "active", worktree_path: null };
  }

  getMembers(teamId: string): Member[] {
    return this.db.prepare("SELECT * FROM members WHERE team_id = ?").all(teamId) as Member[];
  }

  updateMemberStatus(teamId: string, agentId: string, status: MemberStatus): void {
    this.db.prepare(
      "UPDATE members SET status = ? WHERE team_id = ? AND agent_id = ?"
    ).run(status, teamId, agentId);
  }

  // --- Tasks ---

  createTask(teamId: string, subject: string, description?: string, assignedTo?: string, blockedBy?: number[]): Task {
    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO tasks (team_id, subject, description, assigned_to, blocked_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(teamId, subject, description ?? null, assignedTo ?? null, blockedBy ? JSON.stringify(blockedBy) : null, now, now);
    return this.getTask(Number(result.lastInsertRowid))!;
  }

  getTask(id: number): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    return {
      ...row,
      blocked_by: row.blocked_by ? JSON.parse(row.blocked_by) : null,
    };
  }

  claimTask(id: number, agentId: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found`);
    if (task.assigned_to && task.status === "in_progress") {
      throw new Error(`Task ${id} is already claimed by ${task.assigned_to}`);
    }
    this.db.prepare(
      "UPDATE tasks SET assigned_to = ?, status = 'in_progress', updated_at = ? WHERE id = ?"
    ).run(agentId, Date.now(), id);
    return this.getTask(id)!;
  }

  updateTask(id: number, status: TaskStatus, result?: string): Task {
    this.db.prepare(
      "UPDATE tasks SET status = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?"
    ).run(status, result ?? null, Date.now(), id);
    return this.getTask(id)!;
  }

  listTasks(teamId: string, filter?: { status?: TaskStatus; assigned_to?: string }): Task[] {
    let sql = "SELECT * FROM tasks WHERE team_id = ?";
    const params: unknown[] = [teamId];

    if (filter?.status) {
      sql += " AND status = ?";
      params.push(filter.status);
    }
    if (filter?.assigned_to) {
      sql += " AND assigned_to = ?";
      params.push(filter.assigned_to);
    }

    sql += " ORDER BY id ASC";

    return (this.db.prepare(sql).all(...params) as any[]).map((row) => ({
      ...row,
      blocked_by: row.blocked_by ? JSON.parse(row.blocked_by) : null,
    }));
  }

  // --- Messages ---

  sendMessage(teamId: string, from: string, to: string | null, content: string): Message {
    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO messages (team_id, from_agent, to_agent, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(teamId, from, to, content, now);
    return {
      id: Number(result.lastInsertRowid),
      team_id: teamId,
      from_agent: from,
      to_agent: to,
      content,
      read: false,
      created_at: now,
    };
  }

  getMessages(teamId: string, forAgent: string, since?: number): Message[] {
    let sql = `SELECT * FROM messages WHERE team_id = ? AND read = 0
               AND (to_agent = ? OR to_agent IS NULL)
               AND from_agent != ?`;
    const params: unknown[] = [teamId, forAgent, forAgent];

    if (since !== undefined) {
      sql += " AND created_at >= ?";
      params.push(since);
    }

    sql += " ORDER BY created_at ASC";

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Mark as read
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      this.db.prepare(
        `UPDATE messages SET read = 1 WHERE id IN (${ids.map(() => "?").join(",")})`
      ).run(...ids);
    }

    return rows.map((row) => ({
      ...row,
      read: !!row.read,
    }));
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All tests PASS

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Clean exit

**Step 4: Commit**

```bash
git add src/mcp-server/db.ts
git commit -m "feat: implement TeamDB with SQLite — teams, tasks, messages, members"
```

---

### Task 6: MCP Server Entry Point + Team Tools — Tests

**Files:**
- Create: `src/mcp-server/tools/team.ts` (stub)
- Create: `src/mcp-server/index.ts` (stub)
- Create: `src/mcp-server/__tests__/tools-team.test.ts`

**Step 1: Write team.ts stub**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDB } from "../db.js";

export function registerTeamTools(server: McpServer, db: TeamDB): void {
  // Will register: create_team, team_status, stop_team
}
```

**Step 2: Write index.ts stub (exports a factory for testing)**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { mkdirSync } from "fs";
import { join } from "path";

export function createServer(dbPath: string): { server: McpServer; db: TeamDB } {
  const server = new McpServer({
    name: "copilot-agent-teams",
    version: "0.1.0",
  });

  const db = new TeamDB(dbPath);

  registerTeamTools(server, db);

  return { server, db };
}

// Main entry — only runs when executed directly
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  const projectRoot = process.cwd();
  const dbDir = join(projectRoot, ".copilot-teams");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "teams.db");

  const { server } = createServer(dbPath);
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("copilot-agent-teams MCP server running on stdio");
  });
}
```

**Step 3: Write failing tests for team tools**

Test team tools by creating the server, getting a reference to the db, and calling MCP tools via the db directly (unit testing the tool handler logic through the db layer, since the MCP SDK test client is heavyweight). We'll test tool registration separately.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "../index.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("team tools (via db)", () => {
  let db: ReturnType<typeof createServer>["db"];
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const result = createServer(join(tmpDir, "test.db"));
    db = result.db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("create_team creates a team and adds the lead as a member", () => {
    const team = db.createTeam("Build auth");
    db.addMember(team.id, "lead", "lead");
    const members = db.getMembers(team.id);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("lead");
  });

  it("team_status returns team with members and task summary", () => {
    const team = db.createTeam("Build auth");
    db.addMember(team.id, "lead", "lead");
    db.createTask(team.id, "Task A");
    db.createTask(team.id, "Task B");
    const tasks = db.listTasks(team.id);
    expect(tasks).toHaveLength(2);
    const members = db.getMembers(team.id);
    expect(members).toHaveLength(1);
  });

  it("stop_team sets status to stopped", () => {
    const team = db.createTeam("Build auth");
    db.updateTeamStatus(team.id, "stopped");
    expect(db.getTeam(team.id)?.status).toBe("stopped");
  });
});
```

**Step 4: Run tests to verify they pass (these test the db interactions that tools will use)**

Run: `npx vitest run src/mcp-server/__tests__/tools-team.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp-server/index.ts src/mcp-server/tools/team.ts src/mcp-server/__tests__/tools-team.test.ts
git commit -m "feat: add MCP server entry point and team tools stub with tests"
```

---

### Task 7: Implement Team Tools

**Files:**
- Modify: `src/mcp-server/tools/team.ts`

**Step 1: Implement the three team tools**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

export function registerTeamTools(server: McpServer, db: TeamDB): void {
  server.registerTool(
    "create_team",
    {
      description: "Create a new agent team with a shared goal. Returns the team ID. The caller becomes the team lead.",
      inputSchema: {
        goal: z.string().describe("The team's objective — what should be accomplished"),
        config: z.string().optional().describe("Optional JSON config string for team settings (e.g. isolation mode)"),
      },
    },
    async ({ goal, config }) => {
      const parsed = config ? JSON.parse(config) : undefined;
      const team = db.createTeam(goal, parsed);
      db.addMember(team.id, "lead", "lead");
      return {
        content: [{ type: "text", text: JSON.stringify(team, null, 2) }],
      };
    }
  );

  server.registerTool(
    "team_status",
    {
      description: "Get an overview of a team: goal, status, members, and task progress breakdown.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
      },
    },
    async ({ team_id }) => {
      const team = db.getTeam(team_id);
      if (!team) return { content: [{ type: "text", text: `Team ${team_id} not found` }], isError: true };

      const members = db.getMembers(team_id);
      const tasks = db.listTasks(team_id);

      const summary = {
        ...team,
        members,
        tasks: {
          total: tasks.length,
          pending: tasks.filter((t) => t.status === "pending").length,
          in_progress: tasks.filter((t) => t.status === "in_progress").length,
          completed: tasks.filter((t) => t.status === "completed").length,
          blocked: tasks.filter((t) => t.status === "blocked").length,
        },
        task_list: tasks,
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.registerTool(
    "stop_team",
    {
      description: "Stop a team. Collects all completed task results into a final summary.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        reason: z.string().optional().describe("Why the team is being stopped"),
      },
    },
    async ({ team_id, reason }) => {
      const team = db.getTeam(team_id);
      if (!team) return { content: [{ type: "text", text: `Team ${team_id} not found` }], isError: true };

      db.updateTeamStatus(team_id, "stopped");
      const tasks = db.listTasks(team_id);
      const completedResults = tasks
        .filter((t) => t.status === "completed" && t.result)
        .map((t) => ({ task: t.subject, result: t.result }));

      const summary = {
        team_id,
        goal: team.goal,
        reason: reason ?? "Team stopped by lead",
        completed_results: completedResults,
        tasks_remaining: tasks.filter((t) => t.status !== "completed").length,
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );
}
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/mcp-server/tools/team.ts
git commit -m "feat: implement create_team, team_status, stop_team MCP tools"
```

---

### Task 8: Task Board Tools

**Files:**
- Create: `src/mcp-server/tools/tasks.ts`
- Modify: `src/mcp-server/index.ts` (register task tools)

**Step 1: Implement task tools**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

export function registerTaskTools(server: McpServer, db: TeamDB): void {
  server.registerTool(
    "create_task",
    {
      description: "Add a task to the team's board. Optionally assign it to a teammate and set dependencies.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        subject: z.string().describe("Brief task title in imperative form"),
        description: z.string().optional().describe("Detailed description of what needs to be done"),
        assigned_to: z.string().optional().describe("Agent ID to assign to (e.g. 'teammate-1')"),
        blocked_by: z.string().optional().describe("JSON array of task IDs that must complete first, e.g. '[1,2]'"),
      },
    },
    async ({ team_id, subject, description, assigned_to, blocked_by }) => {
      const blockers = blocked_by ? JSON.parse(blocked_by) : undefined;
      const task = db.createTask(team_id, subject, description, assigned_to, blockers);
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "claim_task",
    {
      description: "Claim an unassigned task from the board. Sets status to in_progress.",
      inputSchema: {
        task_id: z.number().describe("The task ID to claim"),
        agent_id: z.string().describe("Your agent ID (e.g. 'teammate-1')"),
      },
    },
    async ({ task_id, agent_id }) => {
      try {
        const task = db.claimTask(task_id, agent_id);
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      description: "Update a task's status. Use 'completed' with a result summary when done. Use 'blocked' if stuck.",
      inputSchema: {
        task_id: z.number().describe("The task ID"),
        status: z.enum(["pending", "in_progress", "completed", "blocked"]).describe("New status"),
        result: z.string().optional().describe("Result summary (required when completing a task)"),
      },
    },
    async ({ task_id, status, result }) => {
      const task = db.updateTask(task_id, status, result);
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List all tasks for a team. Optionally filter by status or assignee.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional().describe("Filter by status"),
        assigned_to: z.string().optional().describe("Filter by assigned agent ID"),
      },
    },
    async ({ team_id, status, assigned_to }) => {
      const filter: { status?: any; assigned_to?: string } = {};
      if (status) filter.status = status;
      if (assigned_to) filter.assigned_to = assigned_to;
      const tasks = db.listTasks(team_id, Object.keys(filter).length > 0 ? filter : undefined);
      return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
    }
  );
}
```

**Step 2: Register in index.ts — add import and call**

Add to `src/mcp-server/index.ts`:
```typescript
import { registerTaskTools } from "./tools/tasks.js";
```
And after `registerTeamTools(server, db);` add:
```typescript
registerTaskTools(server, db);
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/mcp-server/tools/tasks.ts src/mcp-server/index.ts
git commit -m "feat: implement create_task, claim_task, update_task, list_tasks MCP tools"
```

---

### Task 9: Messaging Tools

**Files:**
- Create: `src/mcp-server/tools/messaging.ts`
- Modify: `src/mcp-server/index.ts` (register messaging tools)

**Step 1: Implement messaging tools**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

export function registerMessagingTools(server: McpServer, db: TeamDB): void {
  server.registerTool(
    "send_message",
    {
      description: "Send a direct message to a specific teammate or the team lead.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        from: z.string().describe("Your agent ID"),
        to: z.string().describe("Recipient agent ID (e.g. 'lead', 'teammate-1')"),
        content: z.string().describe("Message content"),
      },
    },
    async ({ team_id, from, to, content }) => {
      const msg = db.sendMessage(team_id, from, to, content);
      return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
    }
  );

  server.registerTool(
    "broadcast",
    {
      description: "Send a message to all team members.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        from: z.string().describe("Your agent ID"),
        content: z.string().describe("Message content"),
      },
    },
    async ({ team_id, from, content }) => {
      const msg = db.sendMessage(team_id, from, null, content);
      return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
    }
  );

  server.registerTool(
    "get_messages",
    {
      description: "Check your inbox for new messages. Returns unread direct messages and broadcasts. Messages are marked read after retrieval.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        for_agent: z.string().describe("Your agent ID"),
        since: z.number().optional().describe("Only get messages after this timestamp (ms)"),
      },
    },
    async ({ team_id, for_agent, since }) => {
      const msgs = db.getMessages(team_id, for_agent, since);
      if (msgs.length === 0) {
        return { content: [{ type: "text", text: "No new messages." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(msgs, null, 2) }] };
    }
  );
}
```

**Step 2: Register in index.ts — add import and call**

Add to `src/mcp-server/index.ts`:
```typescript
import { registerMessagingTools } from "./tools/messaging.js";
```
And after `registerTaskTools(server, db);` add:
```typescript
registerMessagingTools(server, db);
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/mcp-server/tools/messaging.ts src/mcp-server/index.ts
git commit -m "feat: implement send_message, broadcast, get_messages MCP tools"
```

---

### Task 10: Agent Definitions

**Files:**
- Create: `agents/team-lead.agent.md`
- Create: `agents/teammate.agent.md`

**Step 1: Write team-lead agent**

```markdown
---
name: team-lead
description: Orchestrates multi-agent teams for complex tasks. Use when a goal requires decomposition into parallel subtasks worked on by independent agents.
tools:
  - create_team
  - team_status
  - stop_team
  - create_task
  - list_tasks
  - update_task
  - send_message
  - broadcast
  - get_messages
  - bash
  - read
  - glob
  - grep
---

You are the team lead. You coordinate a team of independent agents to accomplish a complex goal.

## Your workflow

1. **Analyze the goal.** Use read, glob, grep to understand the codebase context.
2. **Decompose into tasks.** Break the goal into independent, parallelizable tasks. Each task should be completable by one teammate without depending on others where possible.
3. **Create the team.** Call `create_team` with the goal.
4. **Create tasks on the board.** Call `create_task` for each subtask. Use `blocked_by` for dependencies. Pre-assign tasks to teammates if the split is clear, or leave unassigned for teammates to claim.
5. **Spawn teammates.** For each teammate, spawn a subagent using the `teammate` agent type. Pass their `agent_id` (e.g. "teammate-1") and `team_id` in the prompt. Spawn with `isolation: "worktree"` by default.
6. **Monitor progress.** Periodically call `team_status` and `list_tasks` to track progress.
7. **Coordinate.** Use `send_message` for targeted instructions. Use `broadcast` for team-wide updates.
8. **Handle blockers.** If a teammate reports being blocked, help them or reassign the task.
9. **Synthesize.** Once all tasks are completed, read task results and produce a unified summary for the user.
10. **Stop the team.** Call `stop_team` with a summary.

## Rules

- Prefer many small tasks over few large ones.
- Make tasks as independent as possible to maximize parallelism.
- Always check `get_messages` after checking status — teammates may need help.
- When spawning teammates, give them clear context: what the codebase is, where relevant files are, what conventions to follow.
- If a task is blocked for too long, intervene: message the teammate, reassign, or break the task down further.
```

**Step 2: Write teammate agent**

```markdown
---
name: teammate
description: Team member that works on tasks from the shared board. Spawned by the team lead with an agent_id and team_id.
tools:
  - claim_task
  - update_task
  - list_tasks
  - send_message
  - get_messages
  - bash
  - read
  - write
  - edit
  - glob
  - grep
---

You are a teammate on an agent team. You work on tasks from the shared task board.

## Your workflow

1. **Check the board.** Call `list_tasks` with your team_id to see available tasks.
2. **Claim a task.** Call `claim_task` on a task assigned to you or any unassigned task.
3. **Do the work.** Use your code tools (read, write, edit, bash, glob, grep) to complete the task.
4. **Report results.** When done, call `update_task` with status "completed" and a concise result summary describing what you did, what files you changed, and any decisions you made.
5. **Check messages.** Call `get_messages` to see if anyone needs something from you.
6. **Pick up next task.** Call `list_tasks` again. If there are more tasks, claim the next one. If no tasks remain, send a message to "lead" saying you're done.

## Rules

- Always claim a task before starting work on it.
- Write concise but complete result summaries — the team lead reads these to understand what happened without seeing your full context.
- If you're blocked, call `update_task` with status "blocked" and `send_message` to "lead" explaining what you need.
- If another teammate messages you, respond via `send_message`.
- Check `get_messages` after completing each task.
- Stay focused on your assigned tasks. Don't do work outside the task board.
```

**Step 3: Commit**

```bash
git add agents/team-lead.agent.md agents/teammate.agent.md
git commit -m "feat: add team-lead and teammate agent definitions"
```

---

### Task 11: Skills (Slash Commands)

**Files:**
- Create: `skills/team-start/SKILL.md`
- Create: `skills/team-status/SKILL.md`
- Create: `skills/team-stop/SKILL.md`

**Step 1: Write /team-start skill**

```markdown
---
name: team-start
description: Start a new agent team to work on a complex goal
---

Start a new agent team. Follow these steps:

1. Call the `create_team` MCP tool with the user's goal.
2. Note the returned team_id.
3. Tell the user: "Team {team_id} created. Goal: {goal}"
4. Invoke the `team-lead` agent with this prompt:

"You are leading team {team_id}. Goal: {goal}. Analyze the codebase, decompose the goal into tasks, spawn teammates, and coordinate until completion."

ARGUMENTS: The user's goal description follows.
```

**Step 2: Write /team-status skill**

```markdown
---
name: team-status
description: Show the status dashboard for an active agent team
---

Show the status of an agent team. Follow these steps:

1. Call the `team_status` MCP tool with the team_id (use the argument if provided, or the most recently created team).
2. Format the response as a dashboard:

```
## Team {id}: {goal}
Status: {status}

### Members
- {agent_id} ({role}) — {status}

### Tasks [{completed}/{total}]
- [x] {subject} — {result preview}
- [ ] {subject} (assigned to {agent}) — {status}
- [ ] {subject} — pending
```

ARGUMENTS: Optional team_id.
```

**Step 3: Write /team-stop skill**

```markdown
---
name: team-stop
description: Stop an active agent team and show final results
---

Stop an agent team and show results. Follow these steps:

1. Call the `stop_team` MCP tool with the team_id and optional reason.
2. Display the final summary: completed task results, remaining tasks, and reason.
3. Tell the user the team has been stopped.

ARGUMENTS: Optional team_id and reason.
```

**Step 4: Commit**

```bash
git add skills/
git commit -m "feat: add /team-start, /team-status, /team-stop slash command skills"
```

---

### Task 12: Hooks

**Files:**
- Modify: `hooks.json`
- Create: `src/hooks/check-active-teams.sh`

**Step 1: Write the session start hook script**

```bash
#!/usr/bin/env bash
# Check for active teams in the project's .copilot-teams/teams.db
DB=".copilot-teams/teams.db"
if [ -f "$DB" ]; then
  ACTIVE=$(sqlite3 "$DB" "SELECT COUNT(*) FROM teams WHERE status = 'active'" 2>/dev/null)
  if [ "$ACTIVE" -gt 0 ]; then
    TEAMS=$(sqlite3 "$DB" "SELECT id, goal FROM teams WHERE status = 'active'" 2>/dev/null)
    echo "Active agent teams found:"
    echo "$TEAMS"
    echo "Use /team-status to see details."
  fi
fi
```

**Step 2: Update hooks.json**

```json
{
  "hooks": {
    "sessionStart": [
      {
        "command": "bash src/hooks/check-active-teams.sh",
        "timeout": 5000
      }
    ]
  }
}
```

**Step 3: Make hook executable**

Run: `chmod +x src/hooks/check-active-teams.sh`

**Step 4: Commit**

```bash
mkdir -p src/hooks
git add hooks.json src/hooks/check-active-teams.sh
git commit -m "feat: add sessionStart hook to detect active teams on resume"
```

---

### Task 13: Build and Verify End-to-End

**Files:**
- No new files

**Step 1: Build TypeScript**

Run: `npm run build`
Expected: Clean compilation, `dist/` directory created

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 3: Verify MCP server starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/mcp-server/index.js 2>/dev/null | head -1`
Expected: JSON response with server capabilities

**Step 4: Verify plugin.json references are correct**

Run: `node -e "const p = require('./plugin.json'); console.log(JSON.stringify(p, null, 2))"`
Expected: Prints the plugin manifest with correct paths

**Step 5: Add dist to .gitignore if not already, commit any fixes**

```bash
git add -A
git commit -m "chore: verify build and end-to-end startup"
```

---

### Task 14: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# copilot-agent-teams

Multi-agent team coordination plugin for GitHub Copilot CLI.

A team lead decomposes complex goals into tasks, spawns teammates that work independently in isolated worktrees, and coordinates them via a shared task board and direct messaging.

## Install

```bash
copilot plugin install owner/copilot-agent-teams
```

Or from local source:
```bash
npm install && npm run build
copilot plugin install ./
```

## Usage

### Slash commands

- `/team-start <goal>` — Start a new team with a goal
- `/team-status [team_id]` — Show team dashboard
- `/team-stop [team_id]` — Stop a team and show results

### Conversational

```
Use the team-lead agent to build a REST API with auth, database, and tests
```

### MCP tools (for agents)

Team: `create_team`, `team_status`, `stop_team`
Tasks: `create_task`, `claim_task`, `update_task`, `list_tasks`
Messages: `send_message`, `broadcast`, `get_messages`

## Architecture

- **MCP server** (Node.js) — coordination brain, exposes all tools
- **SQLite** — persistent state in `.copilot-teams/teams.db`
- **Agent definitions** — team-lead orchestrator + teammate worker
- **Skills** — slash commands wrapping MCP tools
- **Hooks** — session resume detection

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, usage, and architecture overview"
```
