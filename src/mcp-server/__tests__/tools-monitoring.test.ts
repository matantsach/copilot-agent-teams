import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Monitoring Tools", () => {
  let client: Client;
  let db: TeamDB;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    const { server, db: database } = createServer(join(tmpDir, "test.db"));
    db = database;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("monitor_teammates returns teammate status with progress", async () => {
    const team = db.createTeam("monitor test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.logAction(team.id, "teammate-1", "task_claim", task.id);

    // Write a progress file where the tool will look for it
    const progressDir = join(tmpDir, ".copilot-teams", "progress", team.id);
    mkdirSync(progressDir, { recursive: true });
    writeFileSync(join(progressDir, "teammate-1.md"), "## 14:30 — Starting\nReading codebase.\n");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content).toHaveLength(1);
    expect(content[0].agent_id).toBe("teammate-1");
    expect(content[0].progress).toContain("Reading codebase");
    expect(content[0].stale).toBe(false);
    expect(content[0].current_task).toBeDefined();
    expect(content[0].current_task.subject).toBe("Do thing");
  });

  it("monitor_teammates handles missing progress file gracefully", async () => {
    const team = db.createTeam("no progress test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].progress).toBeNull();
  });

  it("monitor_teammates flags stale teammates", async () => {
    const team = db.createTeam("stale test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");

    // Use a very short threshold so the file is immediately stale
    const progressDir = join(tmpDir, ".copilot-teams", "progress", team.id);
    mkdirSync(progressDir, { recursive: true });
    writeFileSync(join(progressDir, "teammate-1.md"), "## 14:30 — Starting\nReading codebase.\n");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id, stale_threshold_seconds: 0 }
    });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].stale).toBe(true);
  });

  it("monitor_teammates shows unread message count", async () => {
    const team = db.createTeam("unread test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);

    db.sendMessage(team.id, "lead", "teammate-1", "Check this");
    db.sendMessage(team.id, "lead", "teammate-1", "And this");

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].unread_messages).toBe(2);
  });

  it("monitor_teammates excludes the lead from results", async () => {
    const team = db.createTeam("exclude lead test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate", tmpDir);

    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    const content = JSON.parse((result.content as any)[0].text);
    const agentIds = content.map((c: any) => c.agent_id);
    expect(agentIds).not.toContain("lead");
  });

  it("monitor_teammates uses worktree_path=null fallback for non-tmux agents", async () => {
    const team = db.createTeam("no worktree test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate"); // no worktree_path

    // The tool should not crash — it should return progress: null for this agent
    const result = await client.callTool({
      name: "monitor_teammates",
      arguments: { team_id: team.id }
    });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content[0].progress).toBeNull();
  });
});
