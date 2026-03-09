import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Messaging Tools", () => {
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

  it("send_message on active team succeeds", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "teammate-1", content: "Start working" } });
    expect(result.isError).toBeFalsy();
  });

  it("send_message to non-member fails", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "ghost", content: "Hi" } });
    expect(result.isError).toBe(true);
  });

  it("send_message on stopped team fails", async () => {
    const team = db.createTeam("Test");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "send_message", arguments: { team_id: team.id, from: "lead", to: "teammate-1", content: "Hi" } });
    expect(result.isError).toBe(true);
  });

  it("broadcast sends to all members except sender", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.addMember(team.id, "teammate-2", "teammate");
    const result = await client.callTool({ name: "broadcast", arguments: { team_id: team.id, from: "lead", content: "All hands" } });
    expect(result.isError).toBeFalsy();

    const m1 = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    const m2 = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-2" } });
    expect(JSON.parse((m1.content as any)[0].text)).toHaveLength(1);
    expect(JSON.parse((m2.content as any)[0].text)).toHaveLength(1);
  });

  it("get_messages works on stopped teams", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "lead", "teammate-1", "Final update");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as any)[0].text)).toHaveLength(1);
  });

  it("get_messages marks as read — second call returns empty", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.addMember(team.id, "teammate-1", "teammate");
    db.sendMessage(team.id, "lead", "teammate-1", "Hi");
    const first = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(JSON.parse((first.content as any)[0].text)).toHaveLength(1);
    const second = await client.callTool({ name: "get_messages", arguments: { team_id: team.id, for_agent: "teammate-1" } });
    expect(JSON.parse((second.content as any)[0].text)).toHaveLength(0);
  });
});
