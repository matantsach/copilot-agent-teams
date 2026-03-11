import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { mkdirSync } from "fs";
import { join } from "path";

const projectRoot = process.env.COPILOT_TEAMS_PROJECT_ROOT || process.cwd();
const dbDir = join(projectRoot, ".copilot-teams");
mkdirSync(dbDir, { recursive: true });

const { server, db } = createServer(join(dbDir, "teams.db"));

function shutdown() { try { db.close(); } catch {} process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { try { db.close(); } catch {} });

const transport = new StdioServerTransport();
server.connect(transport).then(() => console.error("copilot-agent-teams MCP server running"));
