import { Database } from "node-sqlite3-wasm";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath);
    const rows = db.all("SELECT id, goal FROM teams WHERE status = 'active'") as any[];
    db.close();
    if (rows.length > 0) {
      console.log("Active agent teams found:");
      for (const row of rows) console.log(`  Team ${row.id}: ${row.goal}`);
      console.log("Use /team-status to see details.");
    }
  } catch {}
}
