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
