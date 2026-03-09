# User Flows: copilot-agent-teams

## Scenario

You have a High-Level Design for **"Add Payment Processing"** spanning 3 repositories:

| Repo | Work |
|------|------|
| `api-gateway` | Add `/payments` route, auth middleware, rate limiting |
| `billing-service` | Stripe integration, webhook handler, invoice model |
| `user-dashboard` | Billing page, payment form, invoice history UI |

You've created GitHub issues in each repo describing the work:
- `api-gateway#12` — Add payment routing and middleware
- `billing-service#8` — Implement Stripe billing integration
- `user-dashboard#15` — Build billing dashboard UI

---

## Flow 1: Start a Team

```
You                          Copilot CLI                    MCP Server
 |                               |                              |
 |  "/team-start"                |                              |
 |  "Implement payment HLD      |                              |
 |   across 3 repos"            |                              |
 |------------------------------>|                              |
 |                               |  create_team(goal)           |
 |                               |----------------------------->|
 |                               |  { team_id: "a1b2c3..." }   |
 |                               |<-----------------------------|
 |                               |                              |
 |                               |  Spawns team-lead agent      |
 |                               |  with team_id + goal         |
 |                               |                              |
```

**What you see:**
```
> /team-start
Goal: Implement payment processing HLD across api-gateway, billing-service, and user-dashboard

Team created: a1b2c3d4e5f67890
Handing off to team-lead agent...
```

---

## Flow 2: Team Lead Decomposes & Ingests Issues

```
Team Lead                                          MCP Server
 |                                                     |
 |  Reads codebase, understands the HLD                |
 |                                                     |
 |  create_tasks_from_issues(                          |
 |    team_id, issues: [12], repo: "you/api-gateway")  |
 |---------------------------------------------------->|
 |  { created: 1, tasks: [{task_id: 1, ...}] }        |
 |<----------------------------------------------------|
 |                                                     |
 |  create_tasks_from_issues(                          |
 |    issues: [8], repo: "you/billing-service")        |
 |---------------------------------------------------->|
 |  { created: 1, tasks: [{task_id: 2, ...}] }        |
 |<----------------------------------------------------|
 |                                                     |
 |  create_tasks_from_issues(                          |
 |    issues: [15], repo: "you/user-dashboard")        |
 |---------------------------------------------------->|
 |  { created: 1, tasks: [{task_id: 3, ...}] }        |
 |<----------------------------------------------------|
 |                                                     |
 |  create_task("Integration tests",                   |
 |    blocked_by: [1, 2, 3])                           |
 |---------------------------------------------------->|
 |  { task_id: 4, status: "blocked" }                  |
 |<----------------------------------------------------|
 |                                                     |
```

**Task board after decomposition:**

```
ID  Status    Subject                              Assigned  Blocked By
--  -------   -----------------------------------  --------  ----------
1   pending   Add payment routing and middleware    -         -
2   pending   Implement Stripe billing             -         -
3   pending   Build billing dashboard UI            -         -
4   blocked   Integration tests                    -         [1, 2, 3]
```

---

## Flow 3: Spawn Teammates with Worktree Isolation

```
Team Lead                    Shell                         Git
 |                             |                            |
 |  bash spawn-teammate.sh     |                            |
 |  a1b2c3 teammate-1          |                            |
 |  "Payment routing"          |                            |
 |---------------------------->|                            |
 |                             |  git worktree add           |
 |                             |  .copilot-teams/worktrees/  |
 |                             |    a1b2c3/teammate-1        |
 |                             |  -b team/a1b2c3/teammate-1  |
 |                             |--------------------------->|
 |                             |  Worktree created           |
 |                             |<---------------------------|
 |                             |                            |
 |                             |  tmux split-window          |
 |                             |  -c <worktree_dir>          |
 |                             |  copilot -a teammate        |
 |                             |                            |
 |  Repeats for teammate-2     |                            |
 |  and teammate-3             |                            |
 |                             |                            |
```

**What your terminal looks like (tmux):**

```
+---------------------------+---------------------------+
|                           |                           |
|  Team Lead                |  teammate-1               |
|  Monitoring progress...   |  Working on task 1:       |
|                           |  "Payment routing"        |
|                           |  Branch: team/a1b2c3/     |
|                           |          teammate-1       |
+---------------------------+---------------------------+
|                           |                           |
|  teammate-2               |  teammate-3               |
|  Working on task 2:       |  Working on task 3:       |
|  "Stripe billing"         |  "Billing dashboard UI"   |
|  Branch: team/a1b2c3/     |  Branch: team/a1b2c3/     |
|          teammate-2       |          teammate-3       |
+---------------------------+---------------------------+
```

Each teammate has its own **git worktree** — they can edit the same files without conflicts.

---

## Flow 4: Teammates Work Independently

Each teammate follows the same loop:

```
Teammate-1                                         MCP Server
 |                                                     |
 |  register_teammate(team_id, "teammate-1")           |
 |---------------------------------------------------->|
 |  { role: "teammate", status: "active" }             |
 |<----------------------------------------------------|
 |                                                     |
 |  list_tasks(team_id)                                |
 |---------------------------------------------------->|
 |  [{ id: 1, subject: "Payment routing", ... }]      |
 |<----------------------------------------------------|
 |                                                     |
 |  claim_task(task_id: 1, agent_id: "teammate-1")     |
 |---------------------------------------------------->|
 |  { status: "in_progress", claimed_at: 1741... }    |
 |<----------------------------------------------------|
 |                                                     |
 |  ~~~ does the work: edits files, runs tests ~~~     |
 |                                                     |
 |  update_task(task_id: 1, status: "completed",       |
 |    result: "Added /payments route with auth...")     |
 |---------------------------------------------------->|
 |  { status: "needs_review", completed_at: 1741... }  |  <-- routed because
 |<----------------------------------------------------|      review_required=true
 |                                                     |
 |  get_messages(team_id, "teammate-1")                |
 |---------------------------------------------------->|
 |  [] (no messages)                                   |
 |<----------------------------------------------------|
 |                                                     |
```

**Key detail:** The teammate called `update_task` with `status: "completed"`, but because the team was created with `config: { review_required: true }`, the server automatically routed it to `needs_review`.

---

## Flow 5: You Check Progress

At any point, you can check what's happening:

```
You                          Copilot CLI                    MCP Server
 |                               |                              |
 |  "/team-status"               |                              |
 |------------------------------>|                              |
 |                               |  team_status(team_id)        |
 |                               |----------------------------->|
 |                               |                              |
```

**What you see:**

```
> /team-status

Team: a1b2c3d4e5f67890
Goal: Implement payment processing HLD
Status: active

Members:
  lead          (lead)       last activity: 2m ago (task_create)
  teammate-1    (teammate)   last activity: 30s ago (task_complete)
  teammate-2    (teammate)   last activity: 1m ago (task_claim)
  teammate-3    (teammate)   last activity: 45s ago (task_claim)

Tasks:
  pending: 0 | in_progress: 2 | needs_review: 1 | completed: 0 | blocked: 1

Task Details:
  #1  Payment routing         needs_review   teammate-1   duration: 8m 32s
  #2  Stripe billing           in_progress    teammate-2   running: 6m 15s
  #3  Billing dashboard UI     in_progress    teammate-3   running: 5m 48s
  #4  Integration tests        blocked        -            blocked by [1,2,3]
```

You can also pull the audit log:

```
> get_audit_log

Recent Actions:
  teammate-1   task_complete    task #1    30s ago
  teammate-3   task_claim       task #3    45s ago
  teammate-2   task_claim       task #2    1m ago
  teammate-1   task_claim       task #1    9m ago
  lead         task_create      task #4    12m ago
  lead         task_create      task #3    12m ago
  lead         task_create      task #2    12m ago
  lead         task_create      task #1    12m ago
  lead         team_create      -          13m ago
```

---

## Flow 6: Review Checkpoint

Task #1 is in `needs_review`. The lead (or you through the lead) reviews it:

```
Team Lead                                          MCP Server
 |                                                     |
 |  Sees task #1 in needs_review                       |
 |  Reviews the diff on branch team/a1b2c3/teammate-1  |
 |                                                     |
 |  Option A — Approve:                                |
 |  approve_task(task_id: 1, agent_id: "lead")         |
 |---------------------------------------------------->|
 |  { status: "completed" }                            |
 |<----------------------------------------------------|
 |                                                     |
 |  (If tasks 2,3 also complete → task #4 auto-        |
 |   unblocks from "blocked" to "pending")             |
 |                                                     |
 |  Option B — Reject:                                 |
 |  reject_task(task_id: 1, agent_id: "lead",          |
 |    feedback: "Missing rate limiting on /payments")   |
 |---------------------------------------------------->|
 |  { status: "in_progress" }                          |
 |<----------------------------------------------------|
 |                                                     |
 |  Server auto-sends message to teammate-1:           |
 |  "Task 'Payment routing' rejected:                  |
 |   Missing rate limiting on /payments"               |
 |                                                     |
```

**If rejected**, teammate-1 picks up the feedback on their next `get_messages` call, reworks, and resubmits.

**If approved**, and once all 3 tasks are approved, task #4 (integration tests) automatically unblocks:

```
ID  Status        Subject                           Assigned
--  -----------   --------------------------------  --------
1   completed     Add payment routing and middleware teammate-1
2   completed     Implement Stripe billing           teammate-2
3   completed     Build billing dashboard UI          teammate-3
4   pending  -->  Integration tests                  -          ← auto-unblocked!
```

---

## Flow 7: Stop Team & Create PRs

Once all tasks are done:

```
You                          Copilot CLI              MCP Server        GitHub
 |                               |                        |                |
 |  "/team-stop"                 |                        |                |
 |------------------------------>|                        |                |
 |                               |  team_status           |                |
 |                               |----------------------->|                |
 |                               |  All tasks completed   |                |
 |                               |<-----------------------|                |
 |                               |                        |                |
 |                               |  stop_team(team_id)    |                |
 |                               |----------------------->|                |
 |                               |  { completed_tasks,    |                |
 |                               |    task_counts }       |                |
 |                               |<-----------------------|                |
 |                               |                        |                |
 |                               |  For each teammate branch:              |
 |                               |  create_pr(team_id,    |                |
 |                               |    agent_id)           |                |
 |                               |----------------------->|                |
 |                               |                        | gh pr create   |
 |                               |                        |--------------->|
 |                               |                        | PR #42 created |
 |                               |                        |<---------------|
 |                               |                        |                |
 |                               |  cleanup-worktrees.sh  |                |
 |                               |  (removes worktrees)   |                |
 |                               |                        |                |
```

**What you see:**

```
> /team-stop

Team a1b2c3d4e5f67890 stopped.

Completed Tasks (4/4):
  #1  Payment routing          teammate-1   8m 32s   "Added /payments route with auth..."
  #2  Stripe billing            teammate-2   12m 5s   "Stripe integration with webhooks..."
  #3  Billing dashboard UI      teammate-3   10m 18s  "Built billing page with invoice..."
  #4  Integration tests         teammate-1   4m 22s   "Added e2e tests for payment flow..."

Pull Requests Created:
  team/a1b2c3/teammate-1  →  PR #42  (payment routing + integration tests)
  team/a1b2c3/teammate-2  →  PR #43  (Stripe billing)
  team/a1b2c3/teammate-3  →  PR #44  (billing dashboard UI)

Worktrees cleaned up: 3
```

---

## End-to-End Timeline

```
 0:00  You: "/team-start — Implement payment HLD"
       ├── Team created, lead agent spawned
       │
 0:01  Lead analyzes codebase + HLD
       ├── Ingests 3 GitHub issues as tasks
       ├── Creates task #4 (integration tests, blocked by 1-3)
       │
 0:02  Lead spawns 3 teammates (each in own worktree + tmux pane)
       ├── teammate-1 → .copilot-teams/worktrees/a1b2c3/teammate-1
       ├── teammate-2 → .copilot-teams/worktrees/a1b2c3/teammate-2
       └── teammate-3 → .copilot-teams/worktrees/a1b2c3/teammate-3
       │
 0:02  All 3 teammates register, claim tasks, start working
  ↓    ~~~ parallel work in isolated worktrees ~~~
 0:10  teammate-1 completes → needs_review
       │
 0:11  You: "/team-status" → see progress dashboard
       │
 0:12  Lead approves task #1
       │
 0:14  teammate-2 completes → needs_review
 0:14  teammate-3 completes → needs_review
       │
 0:15  Lead approves tasks #2 and #3
       ├── Task #4 auto-unblocks!
       │
 0:15  teammate-1 claims task #4 (integration tests)
       │
 0:20  teammate-1 completes task #4 → needs_review → approved
       │
 0:20  You: "/team-stop"
       ├── Results collected
       ├── 3 PRs created (one per teammate branch)
       ├── Worktrees cleaned up
       └── Done. ~20 minutes for work that would take hours sequentially.
```

---

## Without tmux (Fallback)

If you're not in a tmux session, teammates run sequentially via the `agent` tool instead of parallel tmux panes. Worktrees are not created. Everything else works the same — the coordination happens through the MCP task board.

```
Team Lead
 |
 |  spawn-teammate.sh → "NOT_IN_TMUX"
 |
 |  Falls back to: agent tool
 |  "You are teammate-1 on team a1b2c3..."
 |  (runs sequentially in current directory)
 |
```

For the full parallel experience, start your session inside tmux:
```bash
tmux new-session
copilot  # then /team-start
```
