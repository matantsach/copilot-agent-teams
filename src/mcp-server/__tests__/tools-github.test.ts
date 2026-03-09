import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("GitHub Tools", () => {
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

  it("create_tasks_from_issues rejects non-member", async () => {
    const team = db.createTeam("Test");
    const result = await client.callTool({
      name: "create_tasks_from_issues",
      arguments: { team_id: team.id, agent_id: "unknown-agent", issue_numbers: [1] },
    });
    expect(result.isError).toBe(true);
  });

  it("create_tasks_from_issues rejects stopped team", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    db.updateTeamStatus(team.id, "stopped");
    const result = await client.callTool({
      name: "create_tasks_from_issues",
      arguments: { team_id: team.id, agent_id: "lead", issue_numbers: [1] },
    });
    expect(result.isError).toBe(true);
  });

  it("create_pr rejects non-existent team", async () => {
    const result = await client.callTool({
      name: "create_pr",
      arguments: { team_id: "nonexistent", agent_id: "lead" },
    });
    expect(result.isError).toBe(true);
  });

  it("create_tasks_from_issues handles gh CLI errors gracefully", async () => {
    const team = db.createTeam("Test");
    db.addMember(team.id, "lead", "lead");
    // Issue 999999 won't exist, gh will fail — but tool should return per-issue errors, not crash
    const result = await client.callTool({
      name: "create_tasks_from_issues",
      arguments: { team_id: team.id, agent_id: "lead", issue_numbers: [999999] },
    });
    // Should not be a top-level error — individual issue errors are in the response
    expect(result.isError).toBeFalsy();
    const content = JSON.parse((result.content as any)[0].text);
    expect(content.created).toBe(0);
    expect(content.tasks[0].error).toBeDefined();
  });
});
