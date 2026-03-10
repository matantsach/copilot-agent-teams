import { Database } from "node-sqlite3-wasm";
import { existsSync } from "fs";

const dbPath = ".copilot-teams/teams.db";
if (existsSync(dbPath)) {
  try {
    const db = new Database(dbPath);

    const teams = db.all("SELECT id FROM teams WHERE status = 'active'") as Array<{ id: string }>;

    for (const team of teams) {
      const parts: string[] = [];

      // Check unread messages for the lead
      const leadRow = db.get(
        "SELECT agent_id FROM members WHERE team_id = ? AND role = 'lead'",
        [team.id]
      ) as { agent_id: string } | undefined;

      if (leadRow) {
        const unreadRow = db.get(
          "SELECT COUNT(*) as count FROM messages WHERE team_id = ? AND to_agent = ? AND read = 0",
          [team.id, leadRow.agent_id]
        ) as { count: number };
        if (unreadRow.count > 0) {
          parts.push(`${unreadRow.count} unread message${unreadRow.count > 1 ? "s" : ""}`);
        }
      }

      // Check blocked tasks without dependency blockers (escalations)
      const blockedRow = db.get(
        "SELECT COUNT(*) as count FROM tasks WHERE team_id = ? AND status = 'blocked' AND (blocked_by IS NULL OR blocked_by = '[]')",
        [team.id]
      ) as { count: number };
      if (blockedRow.count > 0) {
        parts.push(`${blockedRow.count} blocked task${blockedRow.count > 1 ? "s" : ""} needing input`);
      }

      if (parts.length > 0) {
        console.log(`[agent-teams] Team ${team.id}: ${parts.join(", ")} — use monitor_teammates for details`);
      }
    }

    db.close();
  } catch (e) { console.error(e); }
}
