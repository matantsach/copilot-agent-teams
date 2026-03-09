import { z } from "zod";

export const agentIdSchema = z.string().regex(/^[a-z0-9-]+$/).max(50);

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
