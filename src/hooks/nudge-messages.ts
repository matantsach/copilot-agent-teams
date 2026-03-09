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
