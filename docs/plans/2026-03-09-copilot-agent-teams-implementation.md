# Copilot Agent Teams — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Copilot CLI plugin that adds multi-agent team coordination via an MCP server backed by SQLite.

**Architecture:** Node.js MCP server (stdio transport) exposes team, task, and messaging tools. SQLite (WASM, no native addons) stores all state in `.copilot-teams/teams.db`. Agent markdown files and skill markdown files are thin wrappers calling MCP tools. Hooks handle session resume and message polling nudges.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk v1.x, node-sqlite3-wasm (WASM SQLite, portable), zod v3, esbuild, vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `esbuild.config.mjs`

**Step 1: Write package.json**

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

**Step 2: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk zod node-sqlite3-wasm
npm install -D typescript @types/node tsx vitest esbuild
```

Note: `node-sqlite3-wasm` replaces `better-sqlite3`. It is pure WASM — no native addons, no C++ compiler needed, fully bundleable and portable across platforms.

**Step 3: Write tsconfig.json**

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

**Step 4: Write esbuild.config.mjs**

Bundles MCP server and hook scripts. Copies the WASM sidecar file for node-sqlite3-wasm.

```javascript
import { build } from "esbuild";
import { cpSync } from "fs";

const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
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
  build({
    ...shared,
    entryPoints: ["src/hooks/nudge-messages.ts"],
    outfile: "dist/hooks/nudge-messages.js",
  }),
]);

// Copy WASM sidecar for node-sqlite3-wasm
cpSync(
  "node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm",
  "dist/mcp-server/node-sqlite3-wasm.wasm"
);
cpSync(
  "node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm",
  "dist/hooks/node-sqlite3-wasm.wasm"
);
```

**Step 5: Write .gitignore**

```
node_modules/
.copilot-teams/
*.db
src/**/*.js
```

Note: `dist/` is NOT gitignored — must be committed for plugin distribution.

**Step 6: Create directory structure**

Run:
```bash
mkdir -p src/mcp-server/tools src/mcp-server/__tests__ src/hooks
mkdir -p agents
mkdir -p skills/team-start skills/team-status skills/team-stop
```

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs .gitignore
git commit -m "chore: scaffold project with TypeScript, esbuild, WASM SQLite, MCP SDK"
```

---

### Task 2: Plugin Manifest Files

**Files:**
- Create: `plugin.json`
- Create: `.mcp.json`
- Create: `hooks.json`

**Step 1: Write plugin.json**

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

**Step 2: Write .mcp.json**

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

**Step 3: Write hooks.json (v1 schema, canonical field names)**

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

**Step 2: Commit**

```bash
git add src/mcp-server/types.ts
git commit -m "feat: add shared types for teams, tasks, messages, members"
```

---

### Task 4: SQLite Database Layer — Tests

**Files:**
- Create: `src/mcp-server/db.ts` (stub)
- Create: `src/mcp-server/__tests__/db.test.ts`

**Step 1: Write db.ts stub**

```typescript
import { Database } from "node-sqlite3-wasm";
import type { Team, Task, Message, Member, TeamStatus, TaskStatus, MemberRole, MemberStatus } from "./types.js";

export class TeamDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.init();
  }

  private init(): void { throw new Error("Not implemented"); }
  close(): void { this.db.close(); }

  createTeam(goal: string, config?: Record<string, unknown>): Team { throw new Error("Not implemented"); }
  getTeam(id: string): Team | undefined { throw new Error("Not implemented"); }
  getActiveTeam(id: string): Team { throw new Error("Not implemented"); }
  updateTeamStatus(id: string, status: TeamStatus): void { throw new Error("Not implemented"); }
  addMember(teamId: string, agentId: string, role: MemberRole): Member { throw new Error("Not implemented"); }
  getMembers(teamId: string): Member[] { throw new Error("Not implemented"); }
  updateMemberStatus(teamId: string, agentId: string, status: MemberStatus): void { throw new Error("Not implemented"); }
  createTask(teamId: string, subject: string, description?: string, assignedTo?: string, blockedBy?: number[]): Task { throw new Error("Not implemented"); }
  getTask(id: number): Task | undefined { throw new Error("Not implemented"); }
  claimTask(id: number, agentId: string): Task { throw new Error("Not implemented"); }
  updateTask(id: number, status: TaskStatus, result?: string): Task { throw new Error("Not implemented"); }
  countTasks(teamId: string): Record<TaskStatus | "total", number> { throw new Error("Not implemented"); }
  listTasks(teamId: string, filter?: { status?: TaskStatus; assigned_to?: string; limit?: number; offset?: number }): Task[] { throw new Error("Not implemented"); }
  sendMessage(teamId: string, from: string, to: string | null, content: string): Message { throw new Error("Not implemented"); }
  getMessages(teamId: string, forAgent: string, since?: number): Message[] { throw new Error("Not implemented"); }
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

    it("getActiveTeam returns active team", () => {
      const team = db.createTeam("Test");
      expect(db.getActiveTeam(team.id).id).toBe(team.id);
    });

    it("getActiveTeam throws for stopped team", () => {
      const team = db.createTeam("Test");
      db.updateTeamStatus(team.id, "stopped");
      expect(() => db.getActiveTeam(team.id)).toThrow("not active");
    });

    it("getActiveTeam throws for non-existent team", () => {
      expect(() => db.getActiveTeam("nope")).toThrow("not found");
    });

    it("updateTeamStatus throws for non-existent team", () => {
      expect(() => db.updateTeamStatus("nope", "stopped")).toThrow();
    });
  });

  describe("members", () => {
    it("adds and lists members", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      expect(db.getMembers(team.id)).toHaveLength(2);
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
      const task = db.createTask(team.id, "Build login", "OAuth flow");
      expect(task.subject).toBe("Build login");
      expect(task.status).toBe("pending");
    });

    it("creates a task with blockers — auto-sets status to blocked", () => {
      const team = db.createTeam("Test");
      const t1 = db.createTask(team.id, "Setup DB");
      const t2 = db.createTask(team.id, "Build API", undefined, undefined, [t1.id]);
      expect(t2.blocked_by).toEqual([t1.id]);
      expect(t2.status).toBe("blocked");
    });

    it("validates blocker IDs exist in same team", () => {
      const team = db.createTeam("Test");
      expect(() => db.createTask(team.id, "Bad", undefined, undefined, [9999])).toThrow("not found");
    });

    it("validates blocker IDs belong to same team", () => {
      const team1 = db.createTeam("Team 1");
      const team2 = db.createTeam("Team 2");
      const t1 = db.createTask(team1.id, "Task in team 1");
      expect(() => db.createTask(team2.id, "Bad", undefined, undefined, [t1.id])).toThrow("different team");
    });

    it("atomically claims an unassigned task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.assigned_to).toBe("teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("respects pre-assignment — only assigned agent can claim", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing", undefined, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow("assigned to teammate-1");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("rejects claim when blockers incomplete", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      expect(() => db.claimTask(task.id, "teammate-1")).toThrow("blocked");
    });

    it("allows claim after blockers complete — auto-unblocked to pending", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      expect(task.status).toBe("blocked");

      db.claimTask(blocker.id, "teammate-1");
      db.updateTask(blocker.id, "completed", "Done");

      // Auto-unblocked
      const refreshed = db.getTask(task.id)!;
      expect(refreshed.status).toBe("pending");

      const claimed = db.claimTask(task.id, "teammate-2");
      expect(claimed.status).toBe("in_progress");
    });

    it("throws when claiming already-claimed task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow();
    });

    it("throws when updating non-existent task", () => {
      expect(() => db.updateTask(9999, "completed")).toThrow("not found");
    });

    it("countTasks returns counts by status", () => {
      const team = db.createTeam("Test");
      db.createTask(team.id, "A");
      db.createTask(team.id, "B");
      const c = db.countTasks(team.id);
      expect(c.total).toBe(2);
      expect(c.pending).toBe(2);
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
    it("sends and receives direct message", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Start");
      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Start");
    });

    it("broadcast expands to per-recipient rows — independent read tracking", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.addMember(team.id, "teammate-2", "teammate");

      db.sendMessage(team.id, "lead", null, "All hands");

      // Each non-sender gets their own copy
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-2")).toHaveLength(1);
      // Sender excluded
      expect(db.getMessages(team.id, "lead")).toHaveLength(0);
    });

    it("broadcast read-tracking is per-recipient", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.addMember(team.id, "teammate-2", "teammate");

      db.sendMessage(team.id, "lead", null, "Broadcast");

      // teammate-1 reads it
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0); // already read

      // teammate-2 still has their unread copy
      expect(db.getMessages(team.id, "teammate-2")).toHaveLength(1);
    });

    it("marks as read atomically — second call returns empty", () => {
      const team = db.createTeam("Test");
      db.sendMessage(team.id, "lead", "teammate-1", "Hi");
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0);
    });
  });
});
```

**Step 3: Run tests — verify they fail**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All FAIL with "Not implemented"

**Step 4: Commit**

```bash
git add src/mcp-server/db.ts src/mcp-server/__tests__/db.test.ts
git commit -m "test: add failing tests for TeamDB"
```

---

### Task 5: SQLite Database Layer — Implementation

**Files:**
- Modify: `src/mcp-server/db.ts`

**Step 1: Implement full database layer**

Key changes from previous version:
- Uses `node-sqlite3-wasm` (WASM, no native addons) instead of `better-sqlite3`
- `createTask` validates blocker IDs exist in same team; auto-sets status to `blocked` if blockers present
- `claimTask` uses atomic UPDATE respecting pre-assignment: `WHERE id = ? AND status = 'pending' AND (assigned_to IS NULL OR assigned_to = ?)`
- Auto-unblock queries both `blocked` and `pending` tasks with blockers (covers all cases)
- `countTasks` uses `SELECT COUNT(*) GROUP BY status` instead of fetching all rows
- `getMessages` wraps read+mark in explicit transaction

```typescript
import { Database } from "node-sqlite3-wasm";
import { randomUUID } from "crypto";
import type { Team, Task, Message, Member, TeamStatus, TaskStatus, MemberRole, MemberStatus } from "./types.js";

export class TeamDB {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
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

  close(): void { this.db.close(); }

  private parseRow<T>(row: Record<string, unknown>, jsonFields: string[] = []): T {
    const result = { ...row };
    for (const field of jsonFields) {
      if (result[field] && typeof result[field] === "string") {
        result[field] = JSON.parse(result[field] as string);
      }
    }
    return result as T;
  }

  // --- Teams ---

  createTeam(goal: string, config?: Record<string, unknown>): Team {
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const now = Date.now();
    this.db.run(
      "INSERT INTO teams (id, goal, status, config, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?)",
      [id, goal, config ? JSON.stringify(config) : null, now, now]
    );
    return this.getTeam(id)!;
  }

  getTeam(id: string): Team | undefined {
    const row = this.db.get("SELECT * FROM teams WHERE id = ?", [id]);
    if (!row) return undefined;
    return this.parseRow<Team>(row, ["config"]);
  }

  getActiveTeam(id: string): Team {
    const team = this.getTeam(id);
    if (!team) throw new Error(`Team '${id}' not found`);
    if (team.status !== "active") throw new Error(`Team '${id}' is not active (status: ${team.status})`);
    return team;
  }

  updateTeamStatus(id: string, status: TeamStatus): void {
    const result = this.db.run("UPDATE teams SET status = ?, updated_at = ? WHERE id = ?", [status, Date.now(), id]);
    if (result.changes === 0) throw new Error(`Team '${id}' not found`);
  }

  // --- Members ---

  addMember(teamId: string, agentId: string, role: MemberRole): Member {
    this.db.run("INSERT INTO members (team_id, agent_id, role, status) VALUES (?, ?, ?, 'active')", [teamId, agentId, role]);
    return { team_id: teamId, agent_id: agentId, role, status: "active" };
  }

  getMembers(teamId: string): Member[] {
    return this.db.all("SELECT * FROM members WHERE team_id = ?", [teamId]) as Member[];
  }

  updateMemberStatus(teamId: string, agentId: string, status: MemberStatus): void {
    const result = this.db.run("UPDATE members SET status = ? WHERE team_id = ? AND agent_id = ?", [status, teamId, agentId]);
    if (result.changes === 0) throw new Error(`Member '${agentId}' not found in team '${teamId}'`);
  }

  // --- Tasks ---

  createTask(teamId: string, subject: string, description?: string, assignedTo?: string, blockedBy?: number[]): Task {
    // Validate blocker IDs
    if (blockedBy && blockedBy.length > 0) {
      for (const bid of blockedBy) {
        const blocker = this.getTask(bid);
        if (!blocker) throw new Error(`Blocker task ${bid} not found`);
        if (blocker.team_id !== teamId) throw new Error(`Blocker task ${bid} belongs to a different team`);
      }
    }

    const now = Date.now();
    const initialStatus = (blockedBy && blockedBy.length > 0) ? "blocked" : "pending";
    const result = this.db.run(
      "INSERT INTO tasks (team_id, subject, description, status, assigned_to, blocked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [teamId, subject, description ?? null, initialStatus, assignedTo ?? null, blockedBy ? JSON.stringify(blockedBy) : null, now, now]
    );
    return this.getTask(Number(result.lastInsertRowid))!;
  }

  getTask(id: number): Task | undefined {
    const row = this.db.get("SELECT * FROM tasks WHERE id = ?", [id]);
    if (!row) return undefined;
    return this.parseRow<Task>(row, ["blocked_by"]);
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

    // Check pre-assignment
    if (task.assigned_to && task.assigned_to !== agentId) {
      throw new Error(`Task ${id} is assigned to ${task.assigned_to}, not ${agentId}`);
    }

    // Atomic claim: single UPDATE with WHERE guard
    const result = this.db.run(
      "UPDATE tasks SET assigned_to = ?, status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'pending' AND (assigned_to IS NULL OR assigned_to = ?)",
      [agentId, Date.now(), id, agentId]
    );

    if (result.changes === 0) {
      throw new Error(`Task ${id} is already claimed or not in pending status`);
    }

    return this.getTask(id)!;
  }

  updateTask(id: number, status: TaskStatus, result?: string): Task {
    const dbResult = this.db.run("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?", [status, result ?? null, Date.now(), id]);
    if (dbResult.changes === 0) throw new Error(`Task ${id} not found`);

    // Auto-unblock: when a task completes, check if it unblocks others
    if (status === "completed") {
      const teamIdRow = this.db.get("SELECT team_id FROM tasks WHERE id = ?", [id]) as any;
      if (teamIdRow) {
        const blocked = this.db.all(
          "SELECT id, blocked_by FROM tasks WHERE team_id = ? AND status IN ('blocked', 'pending') AND blocked_by IS NOT NULL",
          [teamIdRow.team_id]
        ) as any[];

        for (const row of blocked) {
          const blockers: number[] = JSON.parse(row.blocked_by);
          if (blockers.includes(id)) {
            const allResolved = blockers.every((bid: number) => {
              const b = this.getTask(bid);
              return b && b.status === "completed";
            });
            if (allResolved) {
              this.db.run("UPDATE tasks SET status = 'pending', updated_at = ? WHERE id = ?", [Date.now(), row.id]);
            }
          }
        }
      }
    }

    return this.getTask(id)!;
  }

  countTasks(teamId: string): Record<TaskStatus | "total", number> {
    const rows = this.db.all(
      "SELECT status, COUNT(*) as count FROM tasks WHERE team_id = ? GROUP BY status",
      [teamId]
    ) as Array<{ status: string; count: number }>;

    const counts: Record<string, number> = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };
    for (const row of rows) {
      counts[row.status] = row.count;
      counts.total += row.count;
    }
    return counts as Record<TaskStatus | "total", number>;
  }

  listTasks(teamId: string, filter?: { status?: TaskStatus; assigned_to?: string; limit?: number; offset?: number }): Task[] {
    let sql = "SELECT * FROM tasks WHERE team_id = ?";
    const params: unknown[] = [teamId];

    if (filter?.status) { sql += " AND status = ?"; params.push(filter.status); }
    if (filter?.assigned_to) { sql += " AND assigned_to = ?"; params.push(filter.assigned_to); }

    sql += " ORDER BY id ASC LIMIT ? OFFSET ?";
    params.push(filter?.limit ?? 20, filter?.offset ?? 0);

    return (this.db.all(sql, params) as any[]).map((row) => this.parseRow<Task>(row, ["blocked_by"]));
  }

  // --- Messages ---

  sendMessage(teamId: string, from: string, to: string | null, content: string): Message {
    const now = Date.now();

    if (to === null) {
      // Broadcast: expand to one row per recipient (excluding sender)
      const members = this.getMembers(teamId);
      let firstId = 0;
      for (const member of members) {
        if (member.agent_id === from) continue;
        const result = this.db.run(
          "INSERT INTO messages (team_id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
          [teamId, from, member.agent_id, content, now]
        );
        if (!firstId) firstId = Number(result.lastInsertRowid);
      }
      return { id: firstId, team_id: teamId, from_agent: from, to_agent: null, content, read: false, created_at: now };
    }

    // Direct message: single row
    const result = this.db.run(
      "INSERT INTO messages (team_id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
      [teamId, from, to, content, now]
    );
    return { id: Number(result.lastInsertRowid), team_id: teamId, from_agent: from, to_agent: to, content, read: false, created_at: now };
  }

  getMessages(teamId: string, forAgent: string, since?: number): Message[] {
    // Atomic read-and-mark-as-read
    // node-sqlite3-wasm: use explicit BEGIN/COMMIT
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let sql = "SELECT * FROM messages WHERE team_id = ? AND read = 0 AND to_agent = ?";
      const params: unknown[] = [teamId, forAgent];
      if (since !== undefined) { sql += " AND created_at >= ?"; params.push(since); }
      sql += " ORDER BY created_at ASC";

      const rows = this.db.all(sql, params) as any[];

      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        this.db.run(`UPDATE messages SET read = 1 WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      }

      this.db.exec("COMMIT");
      return rows.map((row) => ({ ...row, read: !!row.read }));
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
```

**Step 2: Run tests**

Run: `npx vitest run src/mcp-server/__tests__/db.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/mcp-server/db.ts
git commit -m "feat: implement TeamDB with WASM SQLite — atomic claims, blocker validation, auto-unblock"
```

---

### Task 6: MCP Server Entry Point

**Files:**
- Create: `src/mcp-server/server.ts` (factory, imported by tests)
- Create: `src/mcp-server/index.ts` (main entry, side effects)

Separating `server.ts` (testable factory) from `index.ts` (main entry with side effects) so test imports don't trigger stdio connection or directory creation.

**Step 1: Write server.ts**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TeamDB } from "./db.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerMessagingTools } from "./tools/messaging.js";

export function createServer(dbPath: string): { server: McpServer; db: TeamDB } {
  const server = new McpServer({ name: "copilot-agent-teams", version: "0.1.0" });
  const db = new TeamDB(dbPath);
  registerTeamTools(server, db);
  registerTaskTools(server, db);
  registerMessagingTools(server, db);
  return { server, db };
}
```

**Step 2: Write index.ts (main entry)**

```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { mkdirSync } from "fs";
import { join } from "path";

const dbDir = join(process.cwd(), ".copilot-teams");
mkdirSync(dbDir, { recursive: true });

const { server, db } = createServer(join(dbDir, "teams.db"));

function shutdown() { try { db.close(); } catch {} process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { try { db.close(); } catch {} });

const transport = new StdioServerTransport();
server.connect(transport).then(() => console.error("copilot-agent-teams MCP server running"));
```

**Step 3: Create tool stubs**

Create `src/mcp-server/tools/team.ts`, `tasks.ts`, `messaging.ts` with empty `register*` functions (same pattern as before).

**Step 4: Commit**

```bash
git add src/mcp-server/server.ts src/mcp-server/index.ts src/mcp-server/tools/
git commit -m "feat: add MCP server entry point (server.ts factory + index.ts main)"
```

---

### Task 7: Team Tools + Tests

**Files:**
- Modify: `src/mcp-server/tools/team.ts`
- Create: `src/mcp-server/__tests__/tools-team.test.ts`

Tests use `InMemoryTransport` + `Client` from MCP SDK. Import `createServer` from `server.ts` (no side effects).

Implementation includes `create_team`, `register_teammate`, `team_status` (uses `countTasks` for accurate counts), `stop_team`. All mutating tools call `getActiveTeam()`. `team_status` allows querying stopped teams.

Same code as before but with these fixes:
- Import from `../server.js` in tests (not `../index.js`)
- `team_status` uses `db.countTasks()` instead of fetching all tasks
- `stop_team` checks `team.status !== 'stopped'` to prevent double-stop

**Step 1: Write tests, Step 2: Run to verify fail, Step 3: Implement, Step 4: Run to verify pass, Step 5: Commit**

```bash
git commit -m "feat: implement team tools with MCP tests (register_teammate, countTasks)"
```

---

### Task 8: Task Board Tools + Tests

**Files:**
- Modify: `src/mcp-server/tools/tasks.ts`
- Create: `src/mcp-server/__tests__/tools-tasks.test.ts`

Same pattern. Tests verify: create with blockers (returns blocked status), claim respects pre-assignment, claim rejects when blocked, pagination works.

All handlers wrap in try/catch, return `isError: true` on failure. `create_task` calls `getActiveTeam()`. `claim_task` and `update_task` look up the task's `team_id` and call `getActiveTeam()`.

**Commit:**
```bash
git commit -m "feat: implement task tools — blocker validation, pre-assignment, auto-unblock"
```

---

### Task 9: Messaging Tools + Tests

Same pattern. `send_message` and `broadcast` call `getActiveTeam()`. `get_messages` does NOT require active team (allows reading messages after team stops).

**Commit:**
```bash
git commit -m "feat: implement messaging tools — atomic read-mark, active team check"
```

---

### Task 10: Agent Definitions

**Files:**
- Create: `agents/team-lead.agent.md`
- Create: `agents/teammate.agent.md`

Same content as previous version (already uses correct `copilot-agent-teams/*` prefix and `agent` tool). No changes needed.

**Commit:**
```bash
git commit -m "feat: add team-lead and teammate agent definitions"
```

---

### Task 11: Skills

Same content as previous version. No changes needed.

**Commit:**
```bash
git commit -m "feat: add /team-start, /team-status, /team-stop skills"
```

---

### Task 12: Hooks

**Files:**
- Modify: `hooks.json`
- Create: `src/hooks/check-active-teams.ts`
- Create: `src/hooks/nudge-messages.ts`

**Step 1: Write check-active-teams.ts (sessionStart)**

```typescript
import { Database } from "node-sqlite3-wasm";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath);
    const rows = db.all("SELECT id, goal FROM teams WHERE status = 'active'") as any[];
    db.close();
    if (rows.length > 0) {
      console.log("Active agent teams found:");
      for (const row of rows) console.log(`  Team ${row.id}: ${row.goal}`);
      console.log("Use /team-status to see details.");
    }
  } catch {}
}
```

**Step 2: Write nudge-messages.ts (postToolUse) — conditional, silent when no teams**

```typescript
import { Database } from "node-sqlite3-wasm";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath);
    const row = db.get("SELECT COUNT(*) as count FROM teams WHERE status = 'active'") as any;
    db.close();
    if (row && row.count > 0) {
      console.log("Reminder: check copilot-agent-teams/get_messages for team messages.");
    }
  } catch {}
}
```

**Step 3: Update hooks.json with canonical field names**

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "node dist/hooks/check-active-teams.js",
        "timeoutSec": 5
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "bash": "node dist/hooks/nudge-messages.js",
        "timeoutSec": 3
      }
    ]
  }
}
```

Uses `bash` and `timeoutSec` (canonical documented fields, not the v1.0.2 aliases).

**Step 4: Commit**

```bash
git add hooks.json src/hooks/
git commit -m "feat: add conditional hooks — silent when no active teams"
```

---

### Task 13: Build and Verify

**Step 1:** Run `npm run build` — expect `dist/` with JS files + WASM sidecars
**Step 2:** Run `npm test` — all pass
**Step 3:** Smoke test MCP server startup
**Step 4:** Commit dist/

```bash
git add dist/
git commit -m "chore: add built dist/ for plugin distribution"
```

---

### Task 14: README

Same as before, updated to mention WASM SQLite portability.

```bash
git commit -m "docs: add README"
```
