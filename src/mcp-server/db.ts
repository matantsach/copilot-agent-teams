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
  isMember(teamId: string, agentId: string): boolean { throw new Error("Not implemented"); }
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
