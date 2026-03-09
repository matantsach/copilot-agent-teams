# Copilot Agent Teams — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Copilot CLI plugin that adds multi-agent team coordination via an MCP server backed by SQLite.

**Architecture:** Node.js MCP server (stdio transport) exposes team, task, and messaging tools. SQLite stores all state in `.copilot-teams/teams.db`. Agent markdown files and skill markdown files are thin wrappers calling MCP tools. Hooks handle session resume and message polling nudges.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk v1.x, better-sqlite3, zod v3, esbuild, vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `esbuild.config.mjs`

**Step 1: Initialize package.json**

```json
{
  "name": "copilot-agent-teams",
  "version": "0.1.0",
  "description": "Multi-agent team coordination plugin for GitHub Copilot CLI",
  "type": "module",
  "main": "dist/mcp-server/index.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
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

Write `package.json` with the above content.

**Step 2: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk zod better-sqlite3
npm install -D typescript @types/better-sqlite3 @types/node tsx vitest esbuild
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

**Step 4: Create esbuild.config.mjs**

Bundles the MCP server and hook scripts into single files with all dependencies (except better-sqlite3 native module which stays external).

```javascript
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["better-sqlite3"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/mcp-server/index.ts"],
    outfile: "dist/mcp-server/index.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/hooks/check-active-teams.ts"],
    outfile: "dist/hooks/check-active-teams.js",
  }),
]);
```

**Step 5: Create .gitignore**

```
node_modules/
.copilot-teams/
*.db
src/**/*.js
```

Note: `dist/` is NOT gitignored — it must be committed for plugin distribution since `/plugin install` does not run build steps.

**Step 6: Create directory structure**

Run:
```bash
mkdir -p src/mcp-server/tools src/mcp-server/__tests__ src/hooks
mkdir -p agents
mkdir -p skills/team-start skills/team-status skills/team-stop
```

**Step 7: Verify build setup**

Run: `npx tsc --noEmit`
Expected: Clean exit (no source files yet)

**Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs .gitignore
git commit -m "chore: scaffold project with TypeScript, esbuild, MCP SDK, and SQLite deps"
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
    "copilot-agent-teams": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp-server/index.js"]
    }
  }
}
```

Note: The server name `copilot-agent-teams` determines the tool namespace. Agents reference tools as `copilot-agent-teams/create_team`, etc.

**Step 3: Create hooks.json (v1 schema, stubs populated in Task 12)**

```json
{
  "version": 1,
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
}
```

**Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean exit

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
import type { Team, Task, Message, Member, TeamStatus, TaskStatus, MemberRole, MemberStatus } from "./types.js";

export class TeamDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.init();
  }

  private init(): void {
    throw new Error("Not implemented");
  }

  close(): void {
    this.db.close();
  }

  createTeam(goal: string, config?: Record<string, unknown>): Team {
    throw new Error("Not implemented");
  }
  getTeam(id: string): Team | undefined {
    throw new Error("Not implemented");
  }
  getActiveTeam(id: string): Team {
    throw new Error("Not implemented");
  }
  updateTeamStatus(id: string, status: TeamStatus): void {
    throw new Error("Not implemented");
  }
  addMember(teamId: string, agentId: string, role: MemberRole): Member {
    throw new Error("Not implemented");
  }
  getMembers(teamId: string): Member[] {
    throw new Error("Not implemented");
  }
  updateMemberStatus(teamId: string, agentId: string, status: MemberStatus): void {
    throw new Error("Not implemented");
  }
  createTask(teamId: string, subject: string, description?: string, assignedTo?: string, blockedBy?: number[]): Task {
    throw new Error("Not implemented");
  }
  getTask(id: number): Task | undefined {
    throw new Error("Not implemented");
  }
  claimTask(id: number, agentId: string): Task {
    throw new Error("Not implemented");
  }
  updateTask(id: number, status: TaskStatus, result?: string): Task {
    throw new Error("Not implemented");
  }
  listTasks(teamId: string, filter?: { status?: TaskStatus; assigned_to?: string; limit?: number; offset?: number }): Task[] {
    throw new Error("Not implemented");
  }
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
    it("creates a team with 16-char id", () => {
      const team = db.createTeam("Build auth system");
      expect(team.id).toHaveLength(16);
      expect(team.goal).toBe("Build auth system");
      expect(team.status).toBe("active");
    });

    it("retrieves a team by id", () => {
      const created = db.createTeam("Build auth system");
      const retrieved = db.getTeam(created.id);
      expect(retrieved).toEqual(created);
    });

    it("getActiveTeam returns active team", () => {
      const team = db.createTeam("Build auth system");
      expect(db.getActiveTeam(team.id)).toEqual(team);
    });

    it("getActiveTeam throws for stopped team", () => {
      const team = db.createTeam("Build auth system");
      db.updateTeamStatus(team.id, "stopped");
      expect(() => db.getActiveTeam(team.id)).toThrow("not active");
    });

    it("getActiveTeam throws for non-existent team", () => {
      expect(() => db.getActiveTeam("nonexistent")).toThrow("not found");
    });

    it("updates team status", () => {
      const team = db.createTeam("Build auth system");
      db.updateTeamStatus(team.id, "completed");
      expect(db.getTeam(team.id)?.status).toBe("completed");
    });

    it("updateTeamStatus throws for non-existent team", () => {
      expect(() => db.updateTeamStatus("nope", "stopped")).toThrow();
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
      expect(db.getMembers(team.id)).toHaveLength(2);
    });

    it("updates member status", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.updateMemberStatus(team.id, "lead", "finished");
      expect(db.getMembers(team.id)[0].status).toBe("finished");
    });

    it("throws on duplicate member", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      expect(() => db.addMember(team.id, "lead", "lead")).toThrow();
    });
  });

  describe("tasks", () => {
    it("creates a task", () => {
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

    it("atomically claims an unassigned task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.assigned_to).toBe("teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("throws when claiming an already-claimed task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow("already claimed");
    });

    it("rejects claim when blockers are incomplete", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      expect(() => db.claimTask(task.id, "teammate-1")).toThrow("blocked");
    });

    it("allows claim when all blockers are completed", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      db.claimTask(blocker.id, "teammate-1");
      db.updateTask(blocker.id, "completed", "Done");
      const claimed = db.claimTask(task.id, "teammate-2");
      expect(claimed.status).toBe("in_progress");
    });

    it("updates task status with result", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const updated = db.updateTask(task.id, "completed", "Done. Created 3 files.");
      expect(updated.status).toBe("completed");
      expect(updated.result).toBe("Done. Created 3 files.");
    });

    it("throws when updating non-existent task", () => {
      expect(() => db.updateTask(9999, "completed")).toThrow("not found");
    });

    it("lists tasks with filters", () => {
      const team = db.createTeam("Test");
      db.createTask(team.id, "Task A");
      const taskB = db.createTask(team.id, "Task B");
      db.claimTask(taskB.id, "teammate-1");

      expect(db.listTasks(team.id)).toHaveLength(2);
      expect(db.listTasks(team.id, { status: "pending" })).toHaveLength(1);
      expect(db.listTasks(team.id, { assigned_to: "teammate-1" })).toHaveLength(1);
    });

    it("respects limit and offset", () => {
      const team = db.createTeam("Test");
      for (let i = 0; i < 5; i++) db.createTask(team.id, `Task ${i}`);
      const page = db.listTasks(team.id, { limit: 2, offset: 2 });
      expect(page).toHaveLength(2);
      expect(page[0].subject).toBe("Task 2");
    });
  });

  describe("messages", () => {
    it("sends a direct message", () => {
      const team = db.createTeam("Test");
      const msg = db.sendMessage(team.id, "lead", "teammate-1", "Start working");
      expect(msg.from_agent).toBe("lead");
      expect(msg.to_agent).toBe("teammate-1");
    });

    it("sends a broadcast (to_agent is null)", () => {
      const team = db.createTeam("Test");
      const msg = db.sendMessage(team.id, "lead", null, "All hands");
      expect(msg.to_agent).toBeNull();
    });

    it("gets unread direct + broadcast messages atomically", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Direct");
      db.sendMessage(team.id, "lead", "teammate-2", "Not for you");
      db.sendMessage(team.id, "teammate-2", null, "Broadcast");

      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe("Direct");
      expect(msgs[1].content).toBe("Broadcast");
    });

    it("marks messages as read atomically — second call returns empty", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Hello");
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0);
    });

    it("excludes self-authored messages", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "teammate-1", null, "My broadcast");
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0);
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
    this.db.pragma("busy_timeout = 5000");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','stopped')),
        config TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','blocked')),
        assigned_to TEXT,
        blocked_by TEXT,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        from_agent TEXT NOT NULL,
        to_agent TEXT,
        content TEXT NOT NULL,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS members (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        role TEXT DEFAULT 'teammate' CHECK(role IN ('lead','teammate')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active','idle','finished')),
        PRIMARY KEY (team_id, agent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_team_status ON tasks(team_id, status);
      CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(team_id, read, to_agent);
    `);
  }

  close(): void {
    this.db.close();
  }

  // --- Teams ---

  createTeam(goal: string, config?: Record<string, unknown>): Team {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
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
    return { ...row, config: row.config ? JSON.parse(row.config) : null };
  }

  getActiveTeam(id: string): Team {
    const team = this.getTeam(id);
    if (!team) throw new Error(`Team '${id}' not found`);
    if (team.status !== "active") throw new Error(`Team '${id}' is not active (status: ${team.status})`);
    return team;
  }

  updateTeamStatus(id: string, status: TeamStatus): void {
    const result = this.db.prepare(
      "UPDATE teams SET status = ?, updated_at = ? WHERE id = ?"
    ).run(status, Date.now(), id);
    if (result.changes === 0) throw new Error(`Team '${id}' not found`);
  }

  // --- Members ---

  addMember(teamId: string, agentId: string, role: MemberRole): Member {
    this.db.prepare(
      `INSERT INTO members (team_id, agent_id, role, status)
       VALUES (?, ?, ?, 'active')`
    ).run(teamId, agentId, role);
    return { team_id: teamId, agent_id: agentId, role, status: "active" };
  }

  getMembers(teamId: string): Member[] {
    return this.db.prepare("SELECT * FROM members WHERE team_id = ?").all(teamId) as Member[];
  }

  updateMemberStatus(teamId: string, agentId: string, status: MemberStatus): void {
    const result = this.db.prepare(
      "UPDATE members SET status = ? WHERE team_id = ? AND agent_id = ?"
    ).run(status, teamId, agentId);
    if (result.changes === 0) throw new Error(`Member '${agentId}' not found in team '${teamId}'`);
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
    return { ...row, blocked_by: row.blocked_by ? JSON.parse(row.blocked_by) : null };
  }

  claimTask(id: number, agentId: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found`);

    // Enforce blocked_by dependencies
    if (task.blocked_by && task.blocked_by.length > 0) {
      for (const blockerId of task.blocked_by) {
        const blocker = this.getTask(blockerId);
        if (!blocker || blocker.status !== "completed") {
          throw new Error(`Task ${id} is blocked by incomplete task ${blockerId}`);
        }
      }
    }

    // Atomic claim: single UPDATE with WHERE guard prevents TOCTOU race
    const result = this.db.prepare(
      `UPDATE tasks SET assigned_to = ?, status = 'in_progress', updated_at = ?
       WHERE id = ? AND (assigned_to IS NULL OR status = 'pending')`
    ).run(agentId, Date.now(), id);

    if (result.changes === 0) {
      throw new Error(`Task ${id} is already claimed by ${task.assigned_to}`);
    }

    return this.getTask(id)!;
  }

  updateTask(id: number, status: TaskStatus, result?: string): Task {
    const dbResult = this.db.prepare(
      "UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?"
    ).run(status, result ?? null, Date.now(), id);
    if (dbResult.changes === 0) throw new Error(`Task ${id} not found`);

    // Auto-unblock: when a task completes, check if it unblocks others
    if (status === "completed") {
      const blocked = this.db.prepare(
        "SELECT id, blocked_by FROM tasks WHERE team_id = (SELECT team_id FROM tasks WHERE id = ?) AND status = 'blocked'"
      ).all(id) as any[];

      for (const row of blocked) {
        const blockers: number[] = JSON.parse(row.blocked_by);
        if (blockers.includes(id)) {
          const allResolved = blockers.every((bid: number) => {
            const b = this.getTask(bid);
            return b && b.status === "completed";
          });
          if (allResolved) {
            this.db.prepare("UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?")
              .run(Date.now(), row.id);
          }
        }
      }
    }

    return this.getTask(id)!;
  }

  listTasks(teamId: string, filter?: { status?: TaskStatus; assigned_to?: string; limit?: number; offset?: number }): Task[] {
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

    const limit = filter?.limit ?? 20;
    const offset = filter?.offset ?? 0;
    sql += " LIMIT ? OFFSET ?";
    params.push(limit, offset);

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
    // Atomic read-and-mark-as-read in a transaction
    const getAndMark = this.db.transaction(() => {
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

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        this.db.prepare(
          `UPDATE messages SET read = 1 WHERE id IN (${ids.map(() => "?").join(",")})`
        ).run(...ids);
      }

      return rows.map((row) => ({ ...row, read: !!row.read }));
    });

    return getAndMark();
  }
}
```

**Step 2: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All PASS

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/mcp-server/db.ts
git commit -m "feat: implement TeamDB — atomic claims, dependency enforcement, transactional messaging"
```

---

### Task 6: MCP Server Entry Point

**Files:**
- Create: `src/mcp-server/index.ts`

**Step 1: Write server entry point with graceful shutdown**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { mkdirSync } from "fs";
import { join } from "path";

export function createServer(dbPath: string): { server: McpServer; db: TeamDB } {
  const server = new McpServer({
    name: "copilot-agent-teams",
    version: "0.1.0",
  });

  const db = new TeamDB(dbPath);

  registerTeamTools(server, db);
  registerTaskTools(server, db);
  registerMessagingTools(server, db);

  return { server, db };
}

// Main entry
const projectRoot = process.cwd();
const dbDir = join(projectRoot, ".copilot-teams");
mkdirSync(dbDir, { recursive: true });
const dbPath = join(dbDir, "teams.db");

const { server, db } = createServer(dbPath);

// Graceful shutdown
function shutdown() {
  try { db.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { try { db.close(); } catch {} });

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("copilot-agent-teams MCP server running on stdio");
});
```

Note: No `isMain` guard — this file is the MCP server entry point, always runs as main. The `createServer` export is used by tests.

**Step 2: Create tool stubs**

Create `src/mcp-server/tools/team.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDB } from "../db.js";
export function registerTeamTools(server: McpServer, db: TeamDB): void {}
```

Create `src/mcp-server/tools/tasks.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDB } from "../db.js";
export function registerTaskTools(server: McpServer, db: TeamDB): void {}
```

Create `src/mcp-server/tools/messaging.ts`:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDB } from "../db.js";
export function registerMessagingTools(server: McpServer, db: TeamDB): void {}
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/mcp-server/index.ts src/mcp-server/tools/
git commit -m "feat: add MCP server entry point with graceful shutdown and tool stubs"
```

---

### Task 7: Team Tools

**Files:**
- Modify: `src/mcp-server/tools/team.ts`
- Create: `src/mcp-server/__tests__/tools-team.test.ts`

**Step 1: Write tests for team tool handlers**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../index.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("team MCP tools", () => {
  let client: Client;
  let db: ReturnType<typeof createServer>["db"];
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const { server, db: database } = createServer(join(tmpDir, "test.db"));
    db = database;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("create_team returns team with lead member", async () => {
    const result = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const team = JSON.parse((result.content as any)[0].text);
    expect(team.goal).toBe("Build auth");
    expect(team.status).toBe("active");
  });

  it("team_status returns members and task counts", async () => {
    const createResult = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const team = JSON.parse((createResult.content as any)[0].text);

    await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Task A" } });

    const statusResult = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    const status = JSON.parse((statusResult.content as any)[0].text);
    expect(status.tasks.total).toBe(1);
    expect(status.members).toHaveLength(1);
  });

  it("team_status returns error for non-existent team", async () => {
    const result = await client.callTool({ name: "team_status", arguments: { team_id: "nope" } });
    expect(result.isError).toBe(true);
  });

  it("register_teammate adds member", async () => {
    const createResult = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const team = JSON.parse((createResult.content as any)[0].text);

    const regResult = await client.callTool({
      name: "register_teammate",
      arguments: { team_id: team.id, agent_id: "teammate-1" },
    });
    expect(regResult.isError).toBeFalsy();

    const statusResult = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    const status = JSON.parse((statusResult.content as any)[0].text);
    expect(status.members).toHaveLength(2);
  });

  it("stop_team collects completed results", async () => {
    const createResult = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const team = JSON.parse((createResult.content as any)[0].text);

    const taskResult = await client.callTool({
      name: "create_task",
      arguments: { team_id: team.id, subject: "Do thing" },
    });
    const task = JSON.parse((taskResult.content as any)[0].text);

    await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    await client.callTool({
      name: "update_task",
      arguments: { task_id: task.id, status: "completed", result: "Done" },
    });

    const stopResult = await client.callTool({
      name: "stop_team",
      arguments: { team_id: team.id, reason: "All done" },
    });
    const summary = JSON.parse((stopResult.content as any)[0].text);
    expect(summary.completed_results).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/tools-team.test.ts`
Expected: FAIL (stubs are empty)

**Step 3: Implement team tools**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

const agentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(50).describe("Agent ID (lowercase letters, numbers, hyphens)");

export function registerTeamTools(server: McpServer, db: TeamDB): void {
  server.registerTool(
    "create_team",
    {
      description: "Create a new agent team with a shared goal. Returns the team with its ID. The caller is registered as the team lead.",
      inputSchema: {
        goal: z.string().describe("The team's objective"),
        config: z.record(z.unknown()).optional().describe("Optional team settings"),
      },
    },
    async ({ goal, config }) => {
      const team = db.createTeam(goal, config);
      db.addMember(team.id, "lead", "lead");
      return { content: [{ type: "text", text: JSON.stringify(team, null, 2) }] };
    }
  );

  server.registerTool(
    "register_teammate",
    {
      description: "Register yourself as a teammate on a team. Call this first when spawned as a teammate.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        agent_id: agentIdSchema,
      },
    },
    async ({ team_id, agent_id }) => {
      try {
        db.getActiveTeam(team_id);
        db.addMember(team_id, agent_id, "teammate");
        return { content: [{ type: "text", text: `Registered ${agent_id} on team ${team_id}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "team_status",
    {
      description: "Get team overview: goal, status, members, and task progress counts.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
      },
    },
    async ({ team_id }) => {
      const team = db.getTeam(team_id);
      if (!team) return { content: [{ type: "text", text: `Team '${team_id}' not found` }], isError: true };

      const members = db.getMembers(team_id);
      const tasks = db.listTasks(team_id, { limit: 100 });

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
      if (!team) return { content: [{ type: "text", text: `Team '${team_id}' not found` }], isError: true };

      db.updateTeamStatus(team_id, "stopped");
      const tasks = db.listTasks(team_id, { limit: 100 });
      const completedResults = tasks
        .filter((t) => t.status === "completed" && t.result)
        .map((t) => ({ task: t.subject, result: t.result }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            team_id,
            goal: team.goal,
            reason: reason ?? "Team stopped",
            completed_results: completedResults,
            tasks_remaining: tasks.filter((t) => t.status !== "completed").length,
          }, null, 2),
        }],
      };
    }
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/tools-team.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/mcp-server/tools/team.ts src/mcp-server/__tests__/tools-team.test.ts
git commit -m "feat: implement create_team, register_teammate, team_status, stop_team with MCP tests"
```

---

### Task 8: Task Board Tools

**Files:**
- Modify: `src/mcp-server/tools/tasks.ts`
- Create: `src/mcp-server/__tests__/tools-tasks.test.ts`

**Step 1: Write tests for task tools**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("task MCP tools", () => {
  let client: Client;
  let db: ReturnType<typeof createServer>["db"];
  let tmpDir: string;
  let teamId: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const { server, db: database } = createServer(join(tmpDir, "test.db"));
    db = database;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: "create_team", arguments: { goal: "Test" } });
    teamId = JSON.parse((result.content as any)[0].text).id;
  });

  afterEach(async () => {
    await client.close();
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("create_task creates a task on the board", async () => {
    const result = await client.callTool({
      name: "create_task",
      arguments: { team_id: teamId, subject: "Build login", description: "OAuth flow" },
    });
    const task = JSON.parse((result.content as any)[0].text);
    expect(task.subject).toBe("Build login");
    expect(task.status).toBe("pending");
  });

  it("create_task with blocked_by as array", async () => {
    const t1 = await client.callTool({ name: "create_task", arguments: { team_id: teamId, subject: "Setup DB" } });
    const task1 = JSON.parse((t1.content as any)[0].text);

    const t2 = await client.callTool({
      name: "create_task",
      arguments: { team_id: teamId, subject: "Build API", blocked_by: [task1.id] },
    });
    const task2 = JSON.parse((t2.content as any)[0].text);
    expect(task2.blocked_by).toEqual([task1.id]);
  });

  it("create_task rejects invalid team_id", async () => {
    const result = await client.callTool({
      name: "create_task",
      arguments: { team_id: "nonexistent", subject: "Fail" },
    });
    expect(result.isError).toBe(true);
  });

  it("claim_task atomically claims a task", async () => {
    const t = await client.callTool({ name: "create_task", arguments: { team_id: teamId, subject: "Do thing" } });
    const task = JSON.parse((t.content as any)[0].text);

    const claimed = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    const result = JSON.parse((claimed.content as any)[0].text);
    expect(result.assigned_to).toBe("teammate-1");
    expect(result.status).toBe("in_progress");
  });

  it("claim_task rejects double-claim", async () => {
    const t = await client.callTool({ name: "create_task", arguments: { team_id: teamId, subject: "Do thing" } });
    const task = JSON.parse((t.content as any)[0].text);

    await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    const second = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-2" } });
    expect(second.isError).toBe(true);
  });

  it("claim_task rejects when blockers incomplete", async () => {
    const t1 = await client.callTool({ name: "create_task", arguments: { team_id: teamId, subject: "Blocker" } });
    const blocker = JSON.parse((t1.content as any)[0].text);

    const t2 = await client.callTool({
      name: "create_task",
      arguments: { team_id: teamId, subject: "Blocked", blocked_by: [blocker.id] },
    });
    const blocked = JSON.parse((t2.content as any)[0].text);

    const result = await client.callTool({ name: "claim_task", arguments: { task_id: blocked.id, agent_id: "teammate-1" } });
    expect(result.isError).toBe(true);
  });

  it("list_tasks supports pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await client.callTool({ name: "create_task", arguments: { team_id: teamId, subject: `Task ${i}` } });
    }
    const result = await client.callTool({
      name: "list_tasks",
      arguments: { team_id: teamId, limit: 2, offset: 2 },
    });
    const tasks = JSON.parse((result.content as any)[0].text);
    expect(tasks).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: FAIL

**Step 3: Implement task tools**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

export function registerTaskTools(server: McpServer, db: TeamDB): void {
  server.registerTool(
    "create_task",
    {
      description: "Add a task to the team's board. Optionally assign to a teammate and set dependencies.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        subject: z.string().describe("Brief task title in imperative form"),
        description: z.string().optional().describe("Detailed description"),
        assigned_to: z.string().optional().describe("Agent ID to assign to"),
        blocked_by: z.array(z.number()).optional().describe("Array of task IDs that must complete first"),
      },
    },
    async ({ team_id, subject, description, assigned_to, blocked_by }) => {
      try {
        db.getActiveTeam(team_id);
        const task = db.createTask(team_id, subject, description, assigned_to, blocked_by);
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "claim_task",
    {
      description: "Atomically claim an unassigned task. Enforces blocked_by dependencies — rejects if blockers are incomplete.",
      inputSchema: {
        task_id: z.number().describe("The task ID to claim"),
        agent_id: z.string().regex(/^[a-z0-9-]+$/).max(50).describe("Your agent ID"),
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
        result: z.string().optional().describe("Result summary (provide when completing)"),
      },
    },
    async ({ task_id, status, result }) => {
      try {
        const task = db.updateTask(task_id, status, result);
        return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List tasks for a team. Filterable by status and assignee. Paginated (default limit 20).",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional().describe("Filter by status"),
        assigned_to: z.string().optional().describe("Filter by assigned agent ID"),
        limit: z.number().optional().describe("Max results (default 20)"),
        offset: z.number().optional().describe("Skip N results for pagination"),
      },
    },
    async ({ team_id, status, assigned_to, limit, offset }) => {
      try {
        const tasks = db.listTasks(team_id, { status, assigned_to, limit, offset });
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/mcp-server/tools/tasks.ts src/mcp-server/__tests__/tools-tasks.test.ts
git commit -m "feat: implement create_task, claim_task, update_task, list_tasks with MCP tests"
```

---

### Task 9: Messaging Tools

**Files:**
- Modify: `src/mcp-server/tools/messaging.ts`
- Create: `src/mcp-server/__tests__/tools-messaging.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("messaging MCP tools", () => {
  let client: Client;
  let db: ReturnType<typeof createServer>["db"];
  let tmpDir: string;
  let teamId: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const { server, db: database } = createServer(join(tmpDir, "test.db"));
    db = database;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({ name: "create_team", arguments: { goal: "Test" } });
    teamId = JSON.parse((result.content as any)[0].text).id;
  });

  afterEach(async () => {
    await client.close();
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("send_message delivers direct message", async () => {
    await client.callTool({
      name: "send_message",
      arguments: { team_id: teamId, from: "lead", to: "teammate-1", content: "Start" },
    });
    const result = await client.callTool({
      name: "get_messages",
      arguments: { team_id: teamId, for_agent: "teammate-1" },
    });
    const msgs = JSON.parse((result.content as any)[0].text);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Start");
  });

  it("broadcast delivers to all except sender", async () => {
    await client.callTool({
      name: "broadcast",
      arguments: { team_id: teamId, from: "lead", content: "All hands" },
    });

    const t1 = await client.callTool({ name: "get_messages", arguments: { team_id: teamId, for_agent: "teammate-1" } });
    expect(JSON.parse((t1.content as any)[0].text)).toHaveLength(1);

    const lead = await client.callTool({ name: "get_messages", arguments: { team_id: teamId, for_agent: "lead" } });
    expect((lead.content as any)[0].text).toBe("No new messages.");
  });

  it("get_messages marks as read — second call returns empty", async () => {
    await client.callTool({
      name: "send_message",
      arguments: { team_id: teamId, from: "lead", to: "teammate-1", content: "Hi" },
    });
    await client.callTool({ name: "get_messages", arguments: { team_id: teamId, for_agent: "teammate-1" } });
    const second = await client.callTool({ name: "get_messages", arguments: { team_id: teamId, for_agent: "teammate-1" } });
    expect((second.content as any)[0].text).toBe("No new messages.");
  });

  it("send_message rejects invalid team", async () => {
    const result = await client.callTool({
      name: "send_message",
      arguments: { team_id: "nope", from: "lead", to: "teammate-1", content: "Hi" },
    });
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/tools-messaging.test.ts`
Expected: FAIL

**Step 3: Implement messaging tools**

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
        to: z.string().describe("Recipient agent ID"),
        content: z.string().describe("Message content"),
      },
    },
    async ({ team_id, from, to, content }) => {
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, to, content);
        return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
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
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, null, content);
        return { content: [{ type: "text", text: JSON.stringify(msg, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_messages",
    {
      description: "Check your inbox. Returns unread direct messages and broadcasts. Messages are marked read after retrieval.",
      inputSchema: {
        team_id: z.string().describe("The team ID"),
        for_agent: z.string().describe("Your agent ID"),
        since: z.number().optional().describe("Only messages after this timestamp (ms)"),
      },
    },
    async ({ team_id, for_agent, since }) => {
      try {
        const msgs = db.getMessages(team_id, for_agent, since);
        if (msgs.length === 0) {
          return { content: [{ type: "text", text: "No new messages." }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(msgs, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/tools-messaging.test.ts`
Expected: All PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/mcp-server/tools/messaging.ts src/mcp-server/__tests__/tools-messaging.test.ts
git commit -m "feat: implement send_message, broadcast, get_messages with MCP tests"
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
  - copilot-agent-teams/*
  - bash
  - read
  - search
  - agent
---

You are the team lead. You coordinate a team of independent agents to accomplish a complex goal.

## Your workflow

1. **Analyze the goal.** Use read, search, bash to understand the codebase context.
2. **Create the team.** Call `copilot-agent-teams/create_team` with the goal.
3. **Decompose into tasks.** Break the goal into independent, parallelizable tasks. Call `copilot-agent-teams/create_task` for each. Use `blocked_by` for dependencies.
4. **Spawn teammates.** For each teammate, use the `agent` tool to spawn a `teammate` subagent. Pass this exact template in the prompt:

   "You are teammate-N on team TEAM_ID. Your agent_id is 'teammate-N' and your team_id is 'TEAM_ID'. First call copilot-agent-teams/register_teammate, then check copilot-agent-teams/list_tasks for your assigned work."

5. **Monitor progress.** After spawning, check `copilot-agent-teams/team_status` and `copilot-agent-teams/get_messages` periodically.
6. **Handle blockers.** If a teammate is stuck, send them a message or reassign the task.
7. **Synthesize.** Once all tasks are completed, read the task results from `copilot-agent-teams/list_tasks` (filter by status=completed) and produce a unified summary.
8. **Stop the team.** Call `copilot-agent-teams/stop_team`.

## Rules

- Prefer many small tasks over few large ones.
- Make tasks as independent as possible to maximize parallelism.
- Teammates share the working directory — decompose tasks to avoid file conflicts.
- Always check `copilot-agent-teams/get_messages` after checking status.
- Give teammates clear context about the codebase and conventions.
```

**Step 2: Write teammate agent**

```markdown
---
name: teammate
description: Team member that works on tasks from the shared board. Spawned by the team lead with an agent_id and team_id.
tools:
  - copilot-agent-teams/*
  - bash
  - read
  - edit
  - search
---

You are a teammate on an agent team. You receive your `agent_id` and `team_id` in your initial prompt.

## Your workflow

1. **Register.** Call `copilot-agent-teams/register_teammate` with your team_id and agent_id.
2. **Check the board.** Call `copilot-agent-teams/list_tasks` to see available tasks.
3. **Claim a task.** Call `copilot-agent-teams/claim_task` on a task assigned to you or any unassigned task.
4. **Do the work.** Use bash, read, edit, search to complete the task.
5. **Report results.** Call `copilot-agent-teams/update_task` with status "completed" and a concise result describing what you did, files changed, and decisions made.
6. **Check messages.** Call `copilot-agent-teams/get_messages` for any messages from the lead or other teammates.
7. **Pick up next task.** Call `copilot-agent-teams/list_tasks` again. If more tasks, claim the next one. If none, send a message to "lead" saying you're done.

## Rules

- Always register first, then claim before starting work.
- Write concise but complete result summaries.
- If blocked, call `copilot-agent-teams/update_task` with status "blocked" and message the lead.
- Check messages after completing each task.
- Stay focused on your assigned tasks.
```

**Step 3: Commit**

```bash
git add agents/
git commit -m "feat: add team-lead and teammate agent definitions with correct MCP tool prefixes"
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
description: Start a new multi-agent team to work on a complex goal. Creates a team and invokes the team-lead orchestrator agent.
---

Start a new agent team. Follow these steps:

1. Call the `copilot-agent-teams/create_team` tool with the user's goal (provided as arguments below).
2. Note the returned team_id.
3. Tell the user: "Team {team_id} created. Goal: {goal}"
4. Use the team-lead custom agent to orchestrate the work. Pass it this prompt: "You are leading team {team_id}. Goal: {goal}. Analyze the codebase, decompose the goal into tasks, spawn teammates, and coordinate until completion."

ARGUMENTS: The user's goal description follows.
```

**Step 2: Write /team-status skill**

```markdown
---
name: team-status
description: Show the status dashboard for an active agent team including members and task progress.
---

Show the status of an agent team:

1. Call `copilot-agent-teams/team_status` with the team_id (use the argument if provided, or ask the user).
2. Format the response as a dashboard:

```
## Team {id}: {goal}
Status: {status}

### Members
- {agent_id} ({role}) — {status}

### Tasks [{completed}/{total}]
- [x] {subject} — {result preview}
- [ ] {subject} (assigned to {agent}) — {status}
```

ARGUMENTS: Optional team_id.
```

**Step 3: Write /team-stop skill**

```markdown
---
name: team-stop
description: Stop an active agent team and display final results summary.
---

Stop an agent team and show results:

1. Call `copilot-agent-teams/stop_team` with the team_id and optional reason.
2. Display the final summary: completed task results, remaining tasks, and reason.

ARGUMENTS: Optional team_id and reason.
```

**Step 4: Commit**

```bash
git add skills/
git commit -m "feat: add /team-start, /team-status, /team-stop skills"
```

---

### Task 12: Hooks

**Files:**
- Modify: `hooks.json`
- Create: `src/hooks/check-active-teams.ts`

**Step 1: Write the session start hook as Node.js (no system sqlite3 dependency)**

```typescript
import Database from "better-sqlite3";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";

if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT id, goal FROM teams WHERE status = 'active'").all() as any[];
    db.close();

    if (rows.length > 0) {
      console.log("Active agent teams found:");
      for (const row of rows) {
        console.log(`  Team ${row.id}: ${row.goal}`);
      }
      console.log("Use /team-status to see details.");
    }
  } catch {
    // DB may be locked or corrupted — skip silently
  }
}
```

**Step 2: Update hooks.json with correct v1 schema**

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "command": "node dist/hooks/check-active-teams.js",
        "timeout": 5
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "command": "echo 'Remember to check copilot-agent-teams/get_messages for new messages from your team.'",
        "timeout": 2
      }
    ]
  }
}
```

**Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add hooks.json src/hooks/check-active-teams.ts
git commit -m "feat: add sessionStart and postToolUse hooks with Node.js scripts"
```

---

### Task 13: Build and Verify End-to-End

**Files:**
- No new files

**Step 1: Build with esbuild**

Run: `npm run build`
Expected: `dist/mcp-server/index.js` and `dist/hooks/check-active-teams.js` created

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 3: Verify MCP server starts**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node dist/mcp-server/index.js 2>/dev/null | head -1`
Expected: JSON response with server capabilities

**Step 4: Commit dist/**

```bash
git add dist/
git commit -m "chore: add built dist/ for plugin distribution"
```

---

### Task 14: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# copilot-agent-teams

Multi-agent team coordination plugin for GitHub Copilot CLI.

A team lead decomposes complex goals into tasks, spawns teammates that work independently, and coordinates via a shared task board and direct messaging.

## Install

```bash
copilot plugin install owner/copilot-agent-teams
```

## Usage

### Slash commands

- `/team-start <goal>` — Start a new team
- `/team-status [team_id]` — Show team dashboard
- `/team-stop [team_id]` — Stop team, show results

### Conversational

```
Use the team-lead agent to build a REST API with auth, database, and tests
```

### MCP tools (for agents)

All tools prefixed with `copilot-agent-teams/`:

**Team:** `create_team`, `register_teammate`, `team_status`, `stop_team`
**Tasks:** `create_task`, `claim_task`, `update_task`, `list_tasks`
**Messages:** `send_message`, `broadcast`, `get_messages`

## Architecture

- **MCP server** (Node.js, stdio) — coordination brain
- **SQLite** — persistent state in `.copilot-teams/teams.db`
- **Agents** — team-lead orchestrator + teammate worker
- **Skills** — slash commands wrapping MCP tools
- **Hooks** — session resume detection + message polling nudges

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```
