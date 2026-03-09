import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Observability Tools", () => {
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

  it("get_audit_log returns actions for a team", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.logAction(team.id, "lead", "team_create");
    db.logAction(team.id, "lead", "task_create", 1);

    const result = await client.callTool({ name: "get_audit_log", arguments: { team_id: team.id } });
    expect(result.isError).toBeFalsy();
    const actions = JSON.parse((result.content as any)[0].text);
    expect(actions).toHaveLength(2);
    expect(actions[0].action_type).toBe("task_create"); // DESC order
  });

  it("get_audit_log filters by agent_id", async () => {
    const team = db.createTeam("Test");
    db.logAction(team.id, "lead", "team_create");
    db.logAction(team.id, "teammate-1", "task_claim", 1);

    const result = await client.callTool({ name: "get_audit_log", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    const actions = JSON.parse((result.content as any)[0].text);
    expect(actions).toHaveLength(1);
    expect(actions[0].agent_id).toBe("teammate-1");
  });

  it("get_audit_log returns error for non-existent team", async () => {
    const result = await client.callTool({ name: "get_audit_log", arguments: { team_id: "nonexistent" } });
    expect(result.isError).toBe(true);
  });

  it("team_status includes task_details and last_activity", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.logAction(team.id, "lead", "team_create");
    db.logAction(team.id, "teammate-1", "task_claim", task.id);

    const result = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.task_details).toBeDefined();
    expect(content.task_details).toHaveLength(1);
    expect(content.task_details[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(content.last_activity).toBeDefined();
    expect(content.last_activity["teammate-1"]).toBeDefined();
    expect(content.last_activity["teammate-1"].action_type).toBe("task_claim");
  });

  it("create_task logs action", async () => {
    const team = db.createTeam("Test");
    await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Do thing" } });
    const actions = db.getAuditLog(team.id, { action_type: "task_create" });
    expect(actions).toHaveLength(1);
  });

  it("claim_task logs action", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    const actions = db.getAuditLog(team.id, { action_type: "task_claim" });
    expect(actions).toHaveLength(1);
    expect(actions[0].agent_id).toBe("teammate-1");
  });

  it("update_task logs task_complete on completion", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed", result: "Done" } });
    const actions = db.getAuditLog(team.id, { action_type: "task_complete" });
    expect(actions).toHaveLength(1);
  });

  it("stop_team logs action", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    await client.callTool({ name: "stop_team", arguments: { team_id: team.id } });
    const actions = db.getAuditLog(team.id, { action_type: "team_stop" });
    expect(actions).toHaveLength(1);
  });
});
