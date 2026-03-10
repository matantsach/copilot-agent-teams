import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TeamDB } from "../db.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("TeamDB", () => {
  let db: TeamDB;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-teams-test-"));
    db = new TeamDB(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  describe("teams", () => {
    it("creates a team with 16-char id", () => {
      const team = db.createTeam("Build auth system");
      expect(team.id).toHaveLength(16);
      expect(team.goal).toBe("Build auth system");
      expect(team.status).toBe("active");
    });

    it("getActiveTeam returns active team", () => {
      const team = db.createTeam("Test");
      expect(db.getActiveTeam(team.id).id).toBe(team.id);
    });

    it("getActiveTeam throws for stopped team", () => {
      const team = db.createTeam("Test");
      db.updateTeamStatus(team.id, "stopped");
      expect(() => db.getActiveTeam(team.id)).toThrow("not active");
    });

    it("getActiveTeam throws for non-existent team", () => {
      expect(() => db.getActiveTeam("nope")).toThrow("not found");
    });

    it("updateTeamStatus throws for non-existent team", () => {
      expect(() => db.updateTeamStatus("nope", "stopped")).toThrow();
    });
  });

  describe("members", () => {
    it("adds and lists members", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      expect(db.getMembers(team.id)).toHaveLength(2);
    });

    it("idempotent — duplicate registration does not throw", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "lead", "lead"); // should not throw
      expect(db.getMembers(team.id)).toHaveLength(1);
    });

    it("addMember with worktree_path stores the path", () => {
      const team = db.createTeam("Test");
      const member = db.addMember(team.id, "teammate-1", "teammate", "/tmp/worktree-1");
      expect(member.worktree_path).toBe("/tmp/worktree-1");
      const members = db.getMembers(team.id);
      expect(members[0].worktree_path).toBe("/tmp/worktree-1");
    });

    it("updateMemberWorktree updates the path", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "teammate-1", "teammate");
      db.updateMemberWorktree(team.id, "teammate-1", "/tmp/new-worktree");
      const members = db.getMembers(team.id);
      expect(members[0].worktree_path).toBe("/tmp/new-worktree");
    });

    it("getWorktrees returns members with worktree paths", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "teammate-1", "teammate", "/tmp/wt-1");
      db.addMember(team.id, "teammate-2", "teammate", "/tmp/wt-2");
      const worktrees = db.getWorktrees(team.id);
      expect(worktrees).toHaveLength(2);
      expect(worktrees[0].agent_id).toBe("teammate-1");
      expect(worktrees[0].worktree_path).toBe("/tmp/wt-1");
    });

    it("getWorktrees excludes members without worktree paths", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate", "/tmp/wt-1");
      const worktrees = db.getWorktrees(team.id);
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].agent_id).toBe("teammate-1");
    });
  });

  describe("tasks", () => {
    it("creates a task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Build login", "OAuth flow");
      expect(task.subject).toBe("Build login");
      expect(task.status).toBe("pending");
    });

    it("creates a task with blockers — auto-sets status to blocked", () => {
      const team = db.createTeam("Test");
      const t1 = db.createTask(team.id, "Setup DB");
      const t2 = db.createTask(team.id, "Build API", undefined, undefined, [t1.id]);
      expect(t2.blocked_by).toEqual([t1.id]);
      expect(t2.status).toBe("blocked");
    });

    it("validates blocker IDs exist in same team", () => {
      const team = db.createTeam("Test");
      expect(() => db.createTask(team.id, "Bad", undefined, undefined, [9999])).toThrow("not found");
    });

    it("validates blocker IDs belong to same team", () => {
      const team1 = db.createTeam("Team 1");
      const team2 = db.createTeam("Team 2");
      const t1 = db.createTask(team1.id, "Task in team 1");
      expect(() => db.createTask(team2.id, "Bad", undefined, undefined, [t1.id])).toThrow("different team");
    });

    it("atomically claims an unassigned task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.assigned_to).toBe("teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("respects pre-assignment — only assigned agent can claim", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing", undefined, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow("assigned to teammate-1");
      const claimed = db.claimTask(task.id, "teammate-1");
      expect(claimed.status).toBe("in_progress");
    });

    it("rejects claim when blockers incomplete", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      expect(() => db.claimTask(task.id, "teammate-1")).toThrow("blocked");
    });

    it("allows claim after blockers complete — auto-unblocked to pending", () => {
      const team = db.createTeam("Test");
      const blocker = db.createTask(team.id, "Setup DB");
      const task = db.createTask(team.id, "Build API", undefined, undefined, [blocker.id]);
      expect(task.status).toBe("blocked");

      db.claimTask(blocker.id, "teammate-1");
      db.updateTask(blocker.id, "completed", "Done");

      // Auto-unblocked
      const refreshed = db.getTask(task.id)!;
      expect(refreshed.status).toBe("pending");

      const claimed = db.claimTask(task.id, "teammate-2");
      expect(claimed.status).toBe("in_progress");
    });

    it("throws when claiming already-claimed task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.claimTask(task.id, "teammate-2")).toThrow();
    });

    it("throws when updating non-existent task", () => {
      expect(() => db.updateTask(9999, "completed", "result")).toThrow("not found");
    });

    it("requires result when completing a task", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.updateTask(task.id, "completed")).toThrow("result is required");
    });

    it("rejects invalid state transitions", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      // completed → pending is invalid
      expect(() => db.updateTask(task.id, "pending")).toThrow("Invalid transition");
    });

    it("reassignTask resets in_progress to pending (lead-only)", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const reset = db.reassignTask(task.id, "lead");
      expect(reset.status).toBe("pending");
      expect(reset.assigned_to).toBeNull();
      // Another agent can now claim it
      const claimed = db.claimTask(task.id, "teammate-2");
      expect(claimed.assigned_to).toBe("teammate-2");
    });

    it("reassignTask rejects non-lead callers", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.reassignTask(task.id, "teammate-1")).toThrow("Only the team lead");
    });

    it("reassignTask rejects non-in_progress tasks", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      expect(() => db.reassignTask(task.id, "lead")).toThrow("not in_progress");
    });

    it("countTasks returns counts by status", () => {
      const team = db.createTeam("Test");
      db.createTask(team.id, "A");
      db.createTask(team.id, "B");
      const c = db.countTasks(team.id);
      expect(c.total).toBe(2);
      expect(c.pending).toBe(2);
    });

    it("respects limit and offset", () => {
      const team = db.createTeam("Test");
      for (let i = 0; i < 5; i++) db.createTask(team.id, `Task ${i}`);
      const page = db.listTasks(team.id, { limit: 2, offset: 2 });
      expect(page).toHaveLength(2);
      expect(page[0].subject).toBe("Task 2");
    });

    it("updateTask routes to needs_review when review_required is set in team config", () => {
      const team = db.createTeam("Test", { review_required: true });
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const updated = db.updateTask(task.id, "completed", "Done");
      expect(updated.status).toBe("needs_review");
      expect(updated.result).toBe("Done");
    });

    it("updateTask completes directly when review_required is not set", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      const updated = db.updateTask(task.id, "completed", "Done");
      expect(updated.status).toBe("completed");
    });

    it("approveTask moves needs_review to completed (lead-only)", () => {
      const team = db.createTeam("Test", { review_required: true });
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      // Should be in needs_review
      expect(db.getTask(task.id)!.status).toBe("needs_review");
      const approved = db.approveTask(task.id, "lead");
      expect(approved.status).toBe("completed");
    });

    it("approveTask triggers auto-unblock of dependent tasks", () => {
      const team = db.createTeam("Test", { review_required: true });
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const t1 = db.createTask(team.id, "First");
      const t2 = db.createTask(team.id, "Second", undefined, undefined, [t1.id]);
      expect(t2.status).toBe("blocked");

      db.claimTask(t1.id, "teammate-1");
      db.updateTask(t1.id, "completed", "Done");
      // t1 is needs_review, t2 should still be blocked
      expect(db.getTask(t2.id)!.status).toBe("blocked");

      db.approveTask(t1.id, "lead");
      // Now t2 should be unblocked
      expect(db.getTask(t2.id)!.status).toBe("pending");
    });

    it("approveTask rejects non-lead callers", () => {
      const team = db.createTeam("Test", { review_required: true });
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      expect(() => db.approveTask(task.id, "teammate-1")).toThrow("Only the team lead");
    });

    it("approveTask rejects tasks not in needs_review", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      expect(() => db.approveTask(task.id, "lead")).toThrow("not in needs_review");
    });

    it("rejectTask moves needs_review to in_progress with feedback message (lead-only)", () => {
      const team = db.createTeam("Test", { review_required: true });
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      const rejected = db.rejectTask(task.id, "lead", "Needs more tests");
      expect(rejected.status).toBe("in_progress");
      // Feedback message should be sent to the assigned agent
      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain("rejected");
      expect(msgs[0].content).toContain("Needs more tests");
    });

    it("rejectTask rejects non-lead callers", () => {
      const team = db.createTeam("Test", { review_required: true });
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      expect(() => db.rejectTask(task.id, "teammate-1", "Bad")).toThrow("Only the team lead");
    });

    it("countTasks includes needs_review count", () => {
      const team = db.createTeam("Test", { review_required: true });
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "completed", "Done");
      const c = db.countTasks(team.id);
      expect(c.needs_review).toBe(1);
      expect(c.total).toBe(1);
    });

    it("allows blocked → in_progress transition (self-unblock after escalation)", () => {
      const team = db.createTeam("Test");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");
      db.updateTask(task.id, "blocked");
      const resumed = db.updateTask(task.id, "in_progress");
      expect(resumed.status).toBe("in_progress");
    });
  });

  describe("messages", () => {
    it("sends and receives direct message", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.sendMessage(team.id, "lead", "teammate-1", "Start");
      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("Start");
    });

    it("broadcast expands to per-recipient rows — independent read tracking", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.addMember(team.id, "teammate-2", "teammate");

      db.sendMessage(team.id, "lead", null, "All hands");

      // Each non-sender gets their own copy
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-2")).toHaveLength(1);
      // Sender excluded
      expect(db.getMessages(team.id, "lead")).toHaveLength(0);
    });

    it("broadcast read-tracking is per-recipient", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.addMember(team.id, "teammate-2", "teammate");

      db.sendMessage(team.id, "lead", null, "Broadcast");

      // teammate-1 reads it
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0); // already read

      // teammate-2 still has their unread copy
      expect(db.getMessages(team.id, "teammate-2")).toHaveLength(1);
    });

    it("rejects direct message to non-member", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      expect(() => db.sendMessage(team.id, "lead", "ghost", "Hi")).toThrow("not a member");
    });

    it("marks as read atomically — second call returns empty", () => {
      const team = db.createTeam("Test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.sendMessage(team.id, "lead", "teammate-1", "Hi");
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(1);
      expect(db.getMessages(team.id, "teammate-1")).toHaveLength(0);
    });

    it("countUnread returns unread message count without consuming", () => {
      const team = db.createTeam("count test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");

      db.sendMessage(team.id, "lead", "teammate-1", "msg 1");
      db.sendMessage(team.id, "lead", "teammate-1", "msg 2");
      db.sendMessage(team.id, "lead", "teammate-1", "msg 3");

      expect(db.countUnread(team.id, "teammate-1")).toBe(3);
      expect(db.countUnread(team.id, "lead")).toBe(0);

      // Consuming messages should NOT affect a prior countUnread result,
      // but a subsequent countUnread should reflect the change
      db.getMessages(team.id, "teammate-1");
      expect(db.countUnread(team.id, "teammate-1")).toBe(0);
    });
  });

  describe("steerTeammate", () => {
    it("steerTeammate sends priority message to teammate", () => {
      const team = db.createTeam("steer test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");

      db.steerTeammate(team.id, "lead", "teammate-1", "Stop, use approach Y instead");

      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe("[PRIORITY] Stop, use approach Y instead");
      expect(msgs[0].from_agent).toBe("lead");
    });

    it("steerTeammate with reassign resets task to pending", () => {
      const team = db.createTeam("steer reassign test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");

      db.steerTeammate(team.id, "lead", "teammate-1", "Task is too complex, reassigning", true);

      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toContain("[PRIORITY]");

      const updated = db.getTask(task.id);
      expect(updated!.status).toBe("pending");
      expect(updated!.assigned_to).toBeNull();
      expect(updated!.claimed_at).toBeNull();
    });

    it("steerTeammate rejects non-lead callers", () => {
      const team = db.createTeam("steer auth test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      db.addMember(team.id, "teammate-2", "teammate");

      expect(() => db.steerTeammate(team.id, "teammate-1", "teammate-2", "Do X")).toThrow("Only the team lead");
    });

    it("steerTeammate rolls back message if reassign fails", () => {
      const team = db.createTeam("steer rollback test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      // Task is pending, not in_progress — reassign should fail

      expect(() => db.steerTeammate(team.id, "lead", "teammate-1", "Reassigning", true)).toThrow();

      // Message should NOT have been sent (transaction rolled back)
      const msgs = db.getMessages(team.id, "teammate-1");
      expect(msgs).toHaveLength(0);
    });

    it("steerTeammate rejects steering a non-member agent", () => {
      const team = db.createTeam("steer non-member test");
      db.addMember(team.id, "lead", "lead");

      expect(() => db.steerTeammate(team.id, "lead", "ghost", "Do X")).toThrow("not a member");
    });

    it("steerTeammate with reassign resets all in_progress tasks", () => {
      const team = db.createTeam("steer multi-task test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task1 = db.createTask(team.id, "Task 1");
      const task2 = db.createTask(team.id, "Task 2");
      db.claimTask(task1.id, "teammate-1");
      db.claimTask(task2.id, "teammate-1");

      db.steerTeammate(team.id, "lead", "teammate-1", "Reassigning all", true);

      expect(db.getTask(task1.id)!.status).toBe("pending");
      expect(db.getTask(task1.id)!.assigned_to).toBeNull();
      expect(db.getTask(task2.id)!.status).toBe("pending");
      expect(db.getTask(task2.id)!.assigned_to).toBeNull();
    });

    it("steerTeammate without reassign preserves task state", () => {
      const team = db.createTeam("steer preserve test");
      db.addMember(team.id, "lead", "lead");
      db.addMember(team.id, "teammate-1", "teammate");
      const task = db.createTask(team.id, "Do thing");
      db.claimTask(task.id, "teammate-1");

      db.steerTeammate(team.id, "lead", "teammate-1", "Try a different approach");

      expect(db.getTask(task.id)!.status).toBe("in_progress");
      expect(db.getTask(task.id)!.assigned_to).toBe("teammate-1");
    });
  });
});
