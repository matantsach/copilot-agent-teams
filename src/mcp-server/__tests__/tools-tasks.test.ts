import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Task Board Tools", () => {
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

  it("create_task on active team succeeds", async () => {
    const team = db.createTeam("Test");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Do thing" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.subject).toBe("Do thing");
    expect(content.status).toBe("pending");
  });

  it("create_task on stopped team fails", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Do thing" } });
    expect(result.isError).toBe(true);
  });

  it("create_task with blockers returns blocked status", async () => {
    const team = db.createTeam("Test");
    const t1 = db.createTask(team.id, "First");
    const result = await client.callTool({ name: "create_task", arguments: { team_id: team.id, subject: "Second", blocked_by: [t1.id] } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("blocked");
  });

  it("claim_task respects pre-assignment", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing", undefined, "teammate-1");
    const fail = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-2" } });
    expect(fail.isError).toBe(true);
    const ok = await client.callTool({ name: "claim_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    expect(ok.isError).toBeFalsy();
  });

  it("update_task requires result on completion", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const fail = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed" } });
    expect(fail.isError).toBe(true);
    const ok = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed", result: "Done" } });
    expect(ok.isError).toBeFalsy();
  });

  it("update_task rejects invalid state transitions", async () => {
    const team = db.createTeam("Test");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "completed", "Done");
    // completed → blocked is invalid
    const result = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "blocked" } });
    expect(result.isError).toBe(true);
  });

  it("reassign_task resets stuck task (lead-only)", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const result = await client.callTool({ name: "reassign_task", arguments: { task_id: task.id, agent_id: "lead" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("pending");
    expect(content.assigned_to).toBeNull();
  });

  it("reassign_task rejects non-lead callers", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const result = await client.callTool({ name: "reassign_task", arguments: { task_id: task.id, agent_id: "teammate-1" } });
    expect(result.isError).toBe(true);
  });

  it("list_tasks with pagination", async () => {
    const team = db.createTeam("Test");
    for (let i = 0; i < 5; i++) db.createTask(team.id, `Task ${i}`);
    const result = await client.callTool({ name: "list_tasks", arguments: { team_id: team.id, limit: 2, offset: 2 } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content).toHaveLength(2);
  });

  it("approve_task via MCP tool", async () => {
    const team = db.createTeam("Test", { review_required: true });
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "completed", "Done");
    expect(db.getTask(task.id)!.status).toBe("needs_review");
    const result = await client.callTool({ name: "approve_task", arguments: { task_id: task.id, agent_id: "lead" } });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("completed");
  });

  it("reject_task via MCP tool", async () => {
    const team = db.createTeam("Test", { review_required: true });
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    db.updateTask(task.id, "completed", "Done");
    const result = await client.callTool({ name: "reject_task", arguments: { task_id: task.id, agent_id: "lead", feedback: "Needs more work" } });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("in_progress");
  });

  it("update_task routes to needs_review when review_required", async () => {
    const team = db.createTeam("Test", { review_required: true });
    const task = db.createTask(team.id, "Do thing");
    db.claimTask(task.id, "teammate-1");
    const result = await client.callTool({ name: "update_task", arguments: { task_id: task.id, status: "completed", result: "Done" } });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.status).toBe("needs_review");
  });
});
