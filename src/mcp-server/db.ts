import { Database } from "node-sqlite3-wasm";
import { randomUUID } from "crypto";
import type { Team, Task, Message, Member, TeamStatus, TaskStatus, MemberRole } from "./types.js";

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

      // Safety net: verify blockers are complete before claiming.
      // Auto-unblock in updateTask should have already set status to "pending",
      // but this check provides a clear error message if a task is still blocked.
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
        const recipients = members.filter(m => m.agent_id !== from);
        if (recipients.length === 0) {
          this.db.exec("ROLLBACK");
          throw new Error("No recipients for broadcast (sender is the only member)");
        }
        let firstId = 0;
        for (const member of recipients) {
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
