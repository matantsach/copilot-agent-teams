import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";
import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export function registerGithubTools(server: McpServer, db: TeamDB): void {
  server.tool("create_tasks_from_issues", "Create tasks from GitHub issues",
    {
      team_id: z.string(),
      agent_id: agentIdSchema,
      issue_numbers: z.array(z.number().int().positive()).max(50),
      repo: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/).optional(),
    },
    async ({ team_id, agent_id, issue_numbers, repo }) => {
      try {
        db.getActiveTeam(team_id);
        if (!db.isMember(team_id, agent_id)) {
          throw new Error(`Agent '${agent_id}' is not a member of team '${team_id}'`);
        }

        const tasks = [];
        for (const num of issue_numbers) {
          try {
            const args = ["issue", "view", String(num)];
            if (repo) args.push("-R", repo);
            args.push("--json", "title,body,labels");
            const issueJson = execFileSync("gh", args, {
              encoding: "utf-8",
              timeout: 15000,
            }).trim();
            const issue = JSON.parse(issueJson);
            const labels = (issue.labels || []).map((l: any) => l.name).join(", ");
            const description = [
              `GitHub Issue #${num}`,
              labels ? `Labels: ${labels}` : "",
              "",
              issue.body || "(no description)",
            ].filter(Boolean).join("\n");

            const task = db.createTask(team_id, issue.title, description);
            tasks.push({ issue_number: num, task_id: task.id, title: issue.title });
          } catch (issueErr: any) {
            tasks.push({ issue_number: num, error: issueErr.message });
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({ created: tasks.filter(t => !('error' in t)).length, tasks }) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool("create_pr", "Create a GitHub pull request from the current branch",
    {
      team_id: z.string(),
      agent_id: agentIdSchema,
      title: z.string().optional(),
      body: z.string().optional(),
      base: z.string().regex(/^[a-zA-Z0-9._\/-]+$/).max(200).optional(),
    },
    async ({ team_id, agent_id, title, body, base }) => {
      try {
        db.getActiveTeam(team_id);
        if (!db.isMember(team_id, agent_id)) {
          throw new Error(`Agent '${agent_id}' is not a member of team '${team_id}'`);
        }

        const team = db.getTeam(team_id)!;

        // Default title to team goal
        const prTitle = title || team.goal;

        // Default body to task results summary
        let prBody = body;
        if (!prBody) {
          const completed = db.listTasks(team_id, { status: "completed", limit: 100 });
          const lines = completed.map(t => `- **${t.subject}**: ${t.result || "completed"}`);
          prBody = [
            "## Summary",
            `Team goal: ${team.goal}`,
            "",
            "## Completed Tasks",
            ...lines,
            "",
            `Created by copilot-agent-teams (team ${team_id})`,
          ].join("\n");
        }

        // Push current branch
        try {
          execFileSync("git", ["push", "-u", "origin", "HEAD"], {
            encoding: "utf-8",
            timeout: 30000,
            stdio: "pipe",
          });
        } catch (pushErr: any) {
          throw new Error(`Failed to push branch: ${pushErr.message}`);
        }

        // Create PR using body-file to avoid large argument issues
        const bodyFile = join(tmpdir(), `pr-body-${randomUUID()}.md`);
        writeFileSync(bodyFile, prBody);
        try {
          const args = ["pr", "create", "--title", prTitle, "--body-file", bodyFile];
          if (base) args.push("--base", base);
          const prOutput = execFileSync("gh", args, {
            encoding: "utf-8",
            timeout: 30000,
          }).trim();
          return { content: [{ type: "text" as const, text: JSON.stringify({ pr_url: prOutput }) }] };
        } finally {
          try { unlinkSync(bodyFile); } catch {}
        }
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: e.message }], isError: true };
      }
    }
  );
}
