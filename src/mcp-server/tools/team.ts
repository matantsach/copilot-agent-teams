import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";

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
