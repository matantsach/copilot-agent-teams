import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";

export function registerTaskTools(server: McpServer, db: TeamDB): void {
  server.tool("create_task", "Create a task on the team board",
    {
      team_id: z.string(),
      subject: z.string().max(200),
      description: z.string().max(10000).optional(),
      assigned_to: agentIdSchema.optional(),
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
    { task_id: z.number(), agent_id: agentIdSchema },
    async ({ task_id, agent_id }) => {
      try {
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
      status: z.enum(["completed", "blocked"]),
      result: z.string().optional(),
    },
    async ({ task_id, status, result }) => {
      try {
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
    { task_id: z.number(), agent_id: agentIdSchema },
    async ({ task_id, agent_id }) => {
      try {
        const existingTask = db.getTask(task_id);
        if (!existingTask) throw new Error(`Task ${task_id} not found`);
        db.getActiveTeam(existingTask.team_id);
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
