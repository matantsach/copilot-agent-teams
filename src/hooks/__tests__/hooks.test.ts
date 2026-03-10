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

    it("outputs nothing when active team has no actionable items", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      db.createTeam("Test");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toBe("");
    });

    it("shows unread message count for the lead", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.sendMessage(team.id, "teammate-1", "lead", "Help?");
      db.sendMessage(team.id, "teammate-1", "lead", "Stuck on X");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("2 unread");
      expect(output).toContain("monitor_teammates");
    });

    it("shows blocked task count for escalation", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "blocked");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("1 blocked");
      expect(output).toContain("monitor_teammates");
    });

    it("shows combined summary when both unread and blocked", () => {
      const dbDir = join(tmpDir, ".copilot-teams");
      mkdirSync(dbDir);
      const db = new TeamDB(join(dbDir, "teams.db"));
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.sendMessage(team.id, "teammate-1", "lead", "Question");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "blocked");
      db.close();
      const output = execSync(`npx tsx ${nudgeMessagesScript}`, { cwd: tmpDir, encoding: "utf8" });
      expect(output).toContain("1 unread");
      expect(output).toContain("1 blocked");
    });
  });
});
