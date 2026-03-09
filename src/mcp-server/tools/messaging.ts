import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";

export function registerMessagingTools(server: McpServer, db: TeamDB): void {
  server.tool("send_message", "Send a direct message to a teammate",
    { team_id: z.string(), from: agentIdSchema, to: agentIdSchema, content: z.string().max(10000) },
    async ({ team_id, from, to, content }) => {
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, to, content);
        db.logAction(team_id, from, "message_send");
        return { content: [{ type: "text", text: JSON.stringify(msg) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    }
  );

  server.tool("broadcast", "Broadcast a message to all teammates",
    { team_id: z.string(), from: agentIdSchema, content: z.string().max(10000) },
    async ({ team_id, from, content }) => {
      try {
        db.getActiveTeam(team_id);
        const msg = db.sendMessage(team_id, from, null, content);
        db.logAction(team_id, from, "message_broadcast");
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
