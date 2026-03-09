import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { TeamDB } from "../../mcp-server/db.js";

// Absolute paths to hook source files (resolved from project root)
const projectRoot = resolve(__dirname, "../../..");
const checkActiveTeamsScript = join(projectRoot, "src/hooks/check-active-teams.ts");
const nudgeMessagesScript = join(projectRoot, "src/hooks/nudge-messages.ts");

describe("Hooks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-hook-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  describe("check-active-teams", () => {
    it("outputs nothing when no DB exists", () => {
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs nothing when no active teams", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.updateTeamStatus(team.id, "stopped");
      db.close();
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs team info when active teams exist", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      db.createTeam("Build auth system");
      db.close();
      const output = execSync(`npx tsx ${checkActiveTeamsScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("Active agent teams found");
      expect(output).toContain("Build auth system");
    });
  });

  describe("nudge-messages", () => {
    it("outputs nothing when no DB exists", () => {
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs nothing when no active teams", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.updateTeamStatus(team.id, "stopped");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("outputs reminder when active teams exist", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      db.createTeam("Test");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("get_messages");
    });
  });
});
