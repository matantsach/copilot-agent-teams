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
  "type": "commonjs",
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
  reassignTask(id: number, callerAgentId: string): Task { throw new Error("Not implemented"); }
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

    it("idempotent — duplicate registration does not throw", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "lead", "lead"); // should not throw
      expect(db.getMembers(team.id)).toHaveLength(1);
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
      expect(() => db.updateTask(9999, "completed", "result")).toThrow("not found");
    });

    it("requires result when completing a task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.updateTask(task.id, "completed")).toThrow("result is required");
    });

    it("rejects invalid state transitions", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      // completed → pending is invalid
      expect(() => db.updateTask(task.id, "pending")).toThrow("Invalid transition");
    });

    it("reassignTask resets in_progress to pending (lead-only)", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const reset = db.reassignTask(task.id, "lead");
      expect(reset.status).toBe("pending");
      expect(reset.assigned_to).toBeNull();
      // Another agent can now claim it
      const claimed = db.claimTask(task.id, "teammate-2");
      expect(claimed.assigned_to).toBe("teammate-2");
    });

    it("reassignTask rejects non-lead callers", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.reassignTask(task.id, "teammate-1")).toThrow("Only the team lead");
    });

    it("reassignTask rejects non-in_progress tasks", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      expect(() => db.reassignTask(task.id, "lead")).toThrow("not in_progress");
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

    it("rejects direct message to non-member", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      expect(() => db.sendMessage(team.id, "lead", "ghost", "Hi")).toThrow("not a member");
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
    this.db.run("INSERT OR IGNORE INTO members (team_id, agent_id, role, status) VALUES (?, ?, ?, 'active')", [teamId, agentId, role]);
    return { team_id: teamId, agent_id: agentId, role, status: "active" };
  }

  isMember(teamId: string, agentId: string): boolean {
    const row = this.db.get("SELECT 1 FROM members WHERE team_id = ? AND agent_id = ?", [teamId, agentId]);
    return !!row;
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
    // Wrap blocker checks + claim in a single IMMEDIATE transaction
    // to prevent TOCTOU races between checking blockers and claiming
    this.db.exec("BEGIN IMMEDIATE");
    try {
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

      this.db.exec("COMMIT");
      return this.getTask(id)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // Valid state transitions (claim_task handles pending→in_progress)
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    in_progress: ["completed", "blocked"],
    blocked: ["pending"], // auto-unblock only, not direct
  };

  updateTask(id: number, status: TaskStatus, result?: string): Task {
    // Enforce result required on completion
    if (status === "completed" && !result) {
      throw new Error("result is required when completing a task");
    }

    // Wrap status update + auto-unblock in a transaction
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.getTask(id);
      if (!task) throw new Error(`Task ${id} not found`);

      // Enforce state transitions
      const allowed = TeamDB.VALID_TRANSITIONS[task.status];
      if (!allowed || !allowed.includes(status)) {
        throw new Error(`Invalid transition: ${task.status} → ${status}`);
      }

      this.db.run("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?", [status, result ?? null, Date.now(), id]);

      // Auto-unblock: when a task completes, check if it unblocks others
      if (status === "completed") {
        const blocked = this.db.all(
          "SELECT id, blocked_by FROM tasks WHERE team_id = ? AND status IN ('blocked', 'pending') AND blocked_by IS NOT NULL",
          [task.team_id]
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

      this.db.exec("COMMIT");
      return this.getTask(id)!;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  reassignTask(id: number, callerAgentId: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task ${id} not found`);
    if (task.status !== "in_progress") throw new Error(`Task ${id} is not in_progress (status: ${task.status})`);

    // Enforce lead-only: caller must be a lead in the task's team
    const members = this.getMembers(task.team_id);
    const caller = members.find(m => m.agent_id === callerAgentId);
    if (!caller || caller.role !== "lead") {
      throw new Error(`Only the team lead can reassign tasks`);
    }

    this.db.run(
      "UPDATE tasks SET status = 'pending', assigned_to = NULL, updated_at = ? WHERE id = ?",
      [Date.now(), id]
    );
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

    // Validate sender is a member
    if (!this.isMember(teamId, from)) {
      throw new Error(`Agent '${from}' is not a member of team '${teamId}'`);
    }

    if (to === null) {
      // Broadcast: expand to one row per recipient (excluding sender)
      // Wrapped in transaction for atomic delivery
      this.db.exec("BEGIN IMMEDIATE");
      try {
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
        this.db.exec("COMMIT");
        return { id: firstId, team_id: teamId, from_agent: from, to_agent: null, content, read: false, created_at: now };
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }

    // Direct message: validate recipient exists
    if (!this.isMember(teamId, to)) {
      throw new Error(`Agent '${to}' is not a member of team '${teamId}'`);
    }

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

**Step 1: Write test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Team Tools", () => {
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

  it("create_team returns team_id and goal", async () => {
    const result = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.id).toHaveLength(16);
    expect(content.goal).toBe("Build auth");
  });

  it("register_teammate succeeds on active team", async () => {
    const team = db.createTeam("Test");
    const result = await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    expect(result.isError).toBeFalsy();
  });

  it("register_teammate is idempotent", async () => {
    const team = db.createTeam("Test");
    await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    const result = await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    expect(result.isError).toBeFalsy();
  });

  it("team_status returns member and task counts", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.createTask(team.id, "Task A");
    const result = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.members).toHaveLength(1);
    expect(content.tasks.total).toBe(1);
  });

  it("team_status works on stopped teams", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    expect(result.isError).toBeFalsy();
  });

  it("stop_team rejects already-stopped teams", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "stop_team", arguments: { team_id: team.id } });
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Write team.ts implementation**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

const agentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(50);

export function registerTeamTools(server: McpServer, db: TeamDB): void {
  server.tool("create_team", "Create a new agent team and register caller as lead",
    { goal: z.string(), config: z.record(z.unknown()).optional() },
    async ({ goal, config }) => {
      try {
        const team = db.createTeam(goal, config);
        db.addMember(team.id, "lead", "lead");
        return { content: [{ type: "text", text: JSON.stringify(team) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("register_teammate", "Register a teammate in an active team (idempotent)",
    { team_id: z.string(), agent_id: agentIdSchema },
    async ({ team_id, agent_id }) => {
      try {
        db.getActiveTeam(team_id);
        const member = db.addMember(team_id, agent_id, "teammate");
        return { content: [{ type: "text", text: JSON.stringify(member) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("team_status", "Get team overview with member list and task counts",
    { team_id: z.string() },
    async ({ team_id }) => {
      try {
        const team = db.getTeam(team_id);
        if (!team) throw new Error(`Team '${team_id}' not found`);
        const members = db.getMembers(team_id);
        const tasks = db.countTasks(team_id);
        return { content: [{ type: "text", text: JSON.stringify({ ...team, members, tasks }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("stop_team", "Stop a team and collect results",
    { team_id: z.string(), reason: z.string().optional() },
    async ({ team_id, reason }) => {
      try {
        const team = db.getTeam(team_id);
        if (!team) throw new Error(`Team '${team_id}' not found`);
        if (team.status === "stopped") throw new Error(`Team '${team_id}' is already stopped`);
        db.updateTeamStatus(team_id, "stopped");
        const completedTasks = db.listTasks(team_id, { status: "completed", limit: 100 });
        const taskCounts = db.countTasks(team_id);
        const incomplete = taskCounts.pending + taskCounts.in_progress + taskCounts.blocked;
        return { content: [{ type: "text", text: JSON.stringify({ team_id, reason, completed_tasks: completedTasks, task_counts: taskCounts, incomplete_count: incomplete }) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );
}
```

**Step 3: Run tests — verify pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-team.test.ts`

**Step 4: Commit**

```bash
git add src/mcp-server/tools/team.ts src/mcp-server/__tests__/tools-team.test.ts
git commit -m "feat: implement team tools with MCP tests — idempotent registration, countTasks"
```

---

### Task 8: Task Board Tools + Tests

**Files:**
- Modify: `src/mcp-server/tools/tasks.ts`
- Create: `src/mcp-server/__tests__/tools-tasks.test.ts`

**Step 1: Write test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Task Board Tools", () => {
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

  it("create_task on active team succeeds", async () => {
    const team = db.createTeam("Test");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Do thing" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.subject).toBe("Do thing");
    expect(content.status).toBe("pending");
  });

  it("create_task on stopped team fails", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Do thing" } });
    expect(result.isError).toBe(true);
  });

  it("create_task with blockers returns blocked status", async () => {
    const team = db.createTeam("Test");
    const t1 = db.createTask(team.id, "First");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Second", blocked_by: [t1.id] } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("blocked");
  });

  it("claim_task respects pre-assignment", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing", undefined, "teammate-1");
    const fail = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-2" } });
    expect(fail.isError).toBe(true);
    const ok = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    expect(ok.isError).toBeFalsy();
  });

  it("update_task requires result on completion", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const fail = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed" } });
    expect(fail.isError).toBe(true);
    const ok = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed", result: "Done" } });
    expect(ok.isError).toBeFalsy();
  });

  it("update_task rejects invalid state transitions", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "completed", "Done");
    const result = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "pending" } });
    expect(result.isError).toBe(true);
  });

  it("reassign_task resets stuck task (lead-only)", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const result = await client.callTool({ name: "reassign_task", arguments: { task_id: task.id, agent_id: "lead" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("pending");
    expect(content.assigned_to).toBeNull();
  });

  it("reassign_task rejects non-lead callers", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const result = await client.callTool({ name: "reassign_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    expect(result.isError).toBe(true);
  });

  it("list_tasks with pagination", async () => {
    const team = db.createTeam("Test");
    for (let i = 0; i < 5; i++) db.createTask(team.id, `Task ${i}`);
    const result = await client.callTool({ name: "list_tasks", arguments: { team_id: team.id, limit: 2, offset: 2 } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content).toHaveLength(2);
  });
});
```

**Step 2: Write tasks.ts implementation**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

export function registerTaskTools(server: McpServer, db: TeamDB): void {
  server.tool("create_task", "Create a task on the team board",
    {
      team_id: z.string(),
      subject: z.string(),
      description: z.string().optional(),
      assigned_to: z.string().regex(/^[a-z0-9-]+$/).max(50).optional(),
      blocked_by: z.array(z.number()).optional(),
    },
    async ({ team_id, subject, description, assigned_to, blocked_by }) => {
      try {
        db.getActiveTeam(team_id);
        const task = db.createTask(team_id, subject, description, assigned_to, blocked_by);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("claim_task", "Atomically claim a task — enforces blockers and pre-assignment",
    { task_id: z.number(), agent_id: z.string().regex(/^[a-z0-9-]+$/).max(50) },
    async ({ task_id, agent_id }) => {
      try {
        // Verify team is active before claiming
        const existingTask = db.getTask(task_id);
        if (!existingTask) throw new Error(`Task ${task_id} not found`);
        db.getActiveTeam(existingTask.team_id);
        const task = db.claimTask(task_id, agent_id);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("update_task", "Update task status. result required when completing.",
    {
      task_id: z.number(),
      status: z.enum(["in_progress", "completed", "blocked"]),
      result: z.string().optional(),
    },
    async ({ task_id, status, result }) => {
      try {
        // Verify team is active before updating
        const existingTask = db.getTask(task_id);
        if (!existingTask) throw new Error(`Task ${task_id} not found`);
        db.getActiveTeam(existingTask.team_id);
        const task = db.updateTask(task_id, status, result);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("reassign_task", "Reset a stuck in_progress task back to pending (lead-only, enforced)",
    { task_id: z.number(), agent_id: z.string().regex(/^[a-z0-9-]+$/).max(50), reason: z.string().optional() },
    async ({ task_id, agent_id }) => {
      try {
        const task = db.reassignTask(task_id, agent_id);
        return { content: [{ type: "text", text: JSON.stringify(task) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("list_tasks", "List tasks with optional filters and pagination",
    {
      team_id: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
      assigned_to: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    async ({ team_id, status, assigned_to, limit, offset }) => {
      try {
        const tasks = db.listTasks(team_id, { status, assigned_to, limit, offset });
        return { content: [{ type: "text", text: JSON.stringify(tasks) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );
}
```

**Step 3: Run tests — verify pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-tasks.test.ts`

**Step 4: Commit**

```bash
git add src/mcp-server/tools/tasks.ts src/mcp-server/__tests__/tools-tasks.test.ts
git commit -m "feat: implement task tools — state transitions, reassign, result required"
```

---

### Task 9: Messaging Tools + Tests

**Files:**
- Modify: `src/mcp-server/tools/messaging.ts`
- Create: `src/mcp-server/__tests__/tools-messaging.test.ts`

**Step 1: Write test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Messaging Tools", () => {
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

  it("send_message on active team succeeds", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "teammate-1", content: "Start working" } });
    expect(result.isError).toBeFalsy();
  });

  it("send_message to non-member fails", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "ghost", content: "Hi" } });
    expect(result.isError).toBe(true);
  });

  it("send_message on stopped team fails", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "teammate-1", content: "Hi" } });
    expect(result.isError).toBe(true);
  });

  it("broadcast sends to all members except sender", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.addMember(team.id, "teammate-2", "teammate");
    const result = await client.callTool({ name: "broadcast", arguments: { team_id: team.id, from: "lead", content: "All hands" } });
    expect(result.isError).toBeFalsy();

    // Each teammate has their own unread copy
    const m1 = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    const m2 = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-2" } });
    expect(JSON.parse((m1.content as any)[0].text)).toHaveLength(1);
    expect(JSON.parse((m2.content as any)[0].text)).toHaveLength(1);
  });

  it("get_messages works on stopped teams", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "lead", "teammate-1", "Final update");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toHaveLength(1);
  });

  it("get_messages marks as read — second call returns empty", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "lead", "teammate-1", "Hi");
    const first = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(JSON.parse((first.content as any)[0].text)).toHaveLength(1);
    const second = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(JSON.parse((second.content as any)[0].text)).toHaveLength(0);
  });
});
```

**Step 2: Write messaging.ts implementation**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";

const agentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(50);

export function registerMessagingTools(server: McpServer, db: TeamDB): void {
  server.tool("send_message", "Send a direct message to a teammate",
    { team_id: z.string(), from: agentIdSchema, to: agentIdSchema, content: z.string() },
    async ({ team_id, from, to, content }) => {
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, to, content);
        return { content: [{ type: "text", text: JSON.stringify(msg) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("broadcast", "Broadcast a message to all teammates",
    { team_id: z.string(), from: agentIdSchema, content: z.string() },
    async ({ team_id, from, content }) => {
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, null, content);
        return { content: [{ type: "text", text: JSON.stringify(msg) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("get_messages", "Poll inbox — returns unread messages, marks as read",
    { team_id: z.string(), for_agent: agentIdSchema, since: z.number().optional() },
    async ({ team_id, for_agent, since }) => {
      try {
        // get_messages works on stopped teams (allow reading final messages)
        const team = db.getTeam(team_id);
        if (!team) throw new Error(`Team '${team_id}' not found`);
        const msgs = db.getMessages(team_id, for_agent, since);
        return { content: [{ type: "text", text: JSON.stringify(msgs) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );
}
```

**Step 3: Run tests — verify pass**

Run: `npx vitest run src/mcp-server/__tests__/tools-messaging.test.ts`

**Step 4: Commit**

```bash
git add src/mcp-server/tools/messaging.ts src/mcp-server/__tests__/tools-messaging.test.ts
git commit -m "feat: implement messaging tools — recipient validation, broadcast, atomic read-mark"
```

---

### Task 10: Agent Definitions

**Files:**
- Create: `agents/team-lead.agent.md`
- Create: `agents/teammate.agent.md`

**Step 1: Write team-lead.agent.md**

````markdown
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

You are a team lead that coordinates multiple agents to accomplish a complex goal.

## Workflow

1. Analyze the codebase using read/search/bash to understand context
2. Call `copilot-agent-teams/create_team` with the goal
3. Decompose into independent, parallelizable tasks via `copilot-agent-teams/create_task`
   - Use `blocked_by` for tasks that depend on other tasks
   - Use `assigned_to` to pre-assign tasks to specific teammates
4. Spawn teammates via the `agent` tool, passing `team_id` and `agent_id` in the prompt
5. Monitor: periodically call `copilot-agent-teams/team_status` and `copilot-agent-teams/get_messages`
6. If a teammate is stuck, use `copilot-agent-teams/reassign_task` to reset their task
7. Once all tasks complete, read task results and synthesize a summary
8. Call `copilot-agent-teams/stop_team`

## Task Decomposition Guidelines

- Minimize file conflicts between teammates (different modules, different test files)
- Make tasks as independent as possible — use `blocked_by` only when truly needed
- Include clear descriptions with exact file paths and expected outcomes
- Each task should be completable in a single focused session
````

**Step 2: Write teammate.agent.md**

````markdown
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

You are a teammate working on tasks from a shared task board.

## Workflow

1. Call `copilot-agent-teams/register_teammate` with the `team_id` and `agent_id` from your prompt
2. Call `copilot-agent-teams/list_tasks` to see assigned/available work
3. Call `copilot-agent-teams/claim_task` on an assigned or unassigned task
4. Do the work using code tools (read, edit, bash, search)
5. Call `copilot-agent-teams/update_task` with status `completed` and a concise `result` summary
6. Call `copilot-agent-teams/get_messages` — check for messages from the lead or other teammates
7. Call `copilot-agent-teams/list_tasks` again — pick up next task or message the lead if done

## Important

- Always register first before doing anything else
- Always provide a `result` summary when completing a task — the lead relies on these
- Check messages after each task — the lead may have new instructions
- If stuck, message the lead via `copilot-agent-teams/send_message`
````

**Step 3: Commit**

```bash
git add agents/team-lead.agent.md agents/teammate.agent.md
git commit -m "feat: add team-lead and teammate agent definitions"
```

---

### Task 11: Skills

**Files:**
- Create: `skills/team-start/SKILL.md`
- Create: `skills/team-status/SKILL.md`
- Create: `skills/team-stop/SKILL.md`

**Step 1: Write team-start/SKILL.md**

````markdown
---
name: team-start
description: Start a new agent team to work on a complex goal
---

Start a new agent team by calling `copilot-agent-teams/create_team` with the user's goal, then invoke the `team-lead` agent to orchestrate the work.

Steps:
1. Call `copilot-agent-teams/create_team` with the goal argument
2. Note the returned `team_id`
3. Invoke the `team-lead` agent with the goal and team_id
````

**Step 2: Write team-status/SKILL.md**

````markdown
---
name: team-status
description: Show the status of an active agent team
---

Show team status by calling `copilot-agent-teams/team_status`.

If no team_id is provided, list recent teams from the database.
Format the output as a readable dashboard showing:
- Team goal and status
- Member list with roles
- Task counts by status (pending, in_progress, completed, blocked)
````

**Step 3: Write team-stop/SKILL.md**

````markdown
---
name: team-stop
description: Stop an active agent team and collect results
---

Stop a team by calling `copilot-agent-teams/stop_team`.

Display the completed task results as a summary.
If tasks are still in progress, warn the user before stopping.
````

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
        "bash": "test -f .copilot-teams/teams.db && node dist/hooks/nudge-messages.js",
        "timeoutSec": 3
      }
    ]
  }
}
```

Uses `bash` and `timeoutSec` (canonical documented fields, not the v1.0.2 aliases). The `postToolUse` hook uses `test -f` to avoid Node.js startup cost when no DB exists.

**Step 4: Commit**

```bash
git add hooks.json src/hooks/
git commit -m "feat: add conditional hooks — silent when no active teams"
```

---

### Task 12.5: Hook Tests

**Files:**
- Create: `src/hooks/__tests__/hooks.test.ts`

**Step 1: Write hook tests**

These tests verify the hooks work correctly by spawning them as child processes and checking their stdout output. Uses `resolve` to construct absolute paths to the source files while setting `cwd` to the temp directory so the hooks' relative `.copilot-teams/teams.db` path resolves correctly.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { TeamDB } from "../mcp-server/db.js";

// Absolute paths to hook source files (resolved from project root)
const projectRoot = resolve(__dirname, "../..");
const checkActiveTeamsScript = join(projectRoot, "src/hooks/check-active-teams.ts");
const nudgeMessagesScript = join(projectRoot, "src/hooks/nudge-messages.ts");

describe("Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-hook-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe("check-active-teams", () => {
    it("outputs nothing when no DB exists", () => {
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs nothing when no active teams", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.updateTeamStatus(team.id, "stopped");
      db.close();
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs team info when active teams exist", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      db.createTeam("Build auth system");
      db.close();
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("Active agent teams found");
      expect(output).toContain("Build auth system");
    });
  });

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

    it("outputs reminder when active teams exist", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      db.createTeam("Test");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("get_messages");
    });
  });
});
```

**Step 2: Run tests — verify pass**

Run: `npx vitest run src/hooks/__tests__/hooks.test.ts`

**Step 3: Commit**

```bash
git add src/hooks/__tests__/hooks.test.ts
git commit -m "test: add hook tests — no DB, no active teams, active teams"
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
