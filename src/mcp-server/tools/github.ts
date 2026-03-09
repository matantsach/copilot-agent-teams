import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TeamDB } from "../db.js";
import { agentIdSchema } from "../types.js";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export function registerGithubTools(server: McpServer, db: TeamDB): void {
  server.tool("create_tasks_from_issues", "Create tasks from GitHub issues",
    {
      team_id: z.string(),
      agent_id: agentIdSchema,
      issue_numbers: z.array(z.number()),
      repo: z.string().optional(),
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
            const repoFlag = repo ? `-R ${repo}` : "";
            const issueJson = execSync(
              `gh issue view ${num} ${repoFlag} --json title,body,labels`,
              { encoding: "utf-8", timeout: 15000 }
            ).trim();
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
      base: z.string().optional(),
    },
    async ({ team_id, agent_id, title, body, base }) => {
      try {
        const team = db.getTeam(team_id);
        if (!team) throw new Error(`Team '${team_id}' not found`);

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

        const baseFlag = base ? `--base ${base}` : "";

        // First, stage and commit any uncommitted changes
        try {
          execSync("git add -A && git commit -m 'chore: teammate work product' --allow-empty", {
            encoding: "utf-8",
            timeout: 15000,
            stdio: "pipe",
          });
        } catch {
          // May already be committed, that's fine
        }

        // Push current branch
        try {
          execSync("git push -u origin HEAD", {
            encoding: "utf-8",
            timeout: 30000,
            stdio: "pipe",
          });
        } catch (pushErr: any) {
          throw new Error(`Failed to push branch: ${pushErr.message}`);
        }

        // Create PR using body-file to avoid shell injection
        const bodyFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
        writeFileSync(bodyFile, prBody);
        try {
          const prOutput = execSync(
            `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body-file "${bodyFile}" ${baseFlag}`,
            { encoding: "utf-8", timeout: 30000 }
          ).trim();
          // gh pr create outputs the PR URL
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
