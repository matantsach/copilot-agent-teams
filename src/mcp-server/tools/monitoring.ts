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
      stale_threshold_seconds: z.number().int().nonnegative().optional().default(120),
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
