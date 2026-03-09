import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Team Tools", () => {
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

  it("create_team returns team_id and goal", async () => {
    const result = await client.callTool({ name: "create_team", arguments: { goal: "Build auth" } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.id).toHaveLength(16);
    expect(content.goal).toBe("Build auth");
  });

  it("register_teammate succeeds on active team", async () => {
    const team = db.createTeam("Test");
    const result = await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    expect(result.isError).toBeFalsy();
  });

  it("register_teammate is idempotent", async () => {
    const team = db.createTeam("Test");
    await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    const result = await client.callTool({ name: "register_teammate", arguments: { team_id: team.id, agent_id: "teammate-1" } });
    expect(result.isError).toBeFalsy();
  });

  it("team_status returns member and task counts", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.createTask(team.id, "Task A");
    const result = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.members).toHaveLength(1);
    expect(content.tasks.total).toBe(1);
  });

  it("team_status works on stopped teams", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "team_status", arguments: { team_id: team.id } });
    expect(result.isError).toBeFalsy();
  });

  it("stop_team rejects already-stopped teams", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "stop_team", arguments: { team_id: team.id } });
    expect(result.isError).toBe(true);
  });
});
