# Tmux-Based Teammate Spawning — Design Document

## Goal

Add tmux-based teammate spawning so teammates run as independent CLI sessions in separate tmux panes with true parallelism and visible progress. Gracefully degrade to the built-in `agent` tool when tmux is unavailable.

## Approach

**Hybrid (Approach C).** Keep the MCP server focused on coordination — no process management. A thin shell script handles tmux detection, pane creation, and fallback. The team lead agent calls the script via bash. Teammates don't care how they were spawned.

## Spawn Script

New file: `scripts/spawn-teammate.sh`

```bash
#!/usr/bin/env bash
# Usage: spawn-teammate.sh <team_id> <agent_id> <task_description> [model]

TEAM_ID="$1"
AGENT_ID="$2"
TASK_DESC="$3"
MODEL="${4:-${TEAMMATE_MODEL:-claude-sonnet-4-6}}"

PROMPT="You are $AGENT_ID on team $TEAM_ID. Register with register_teammate, then list_tasks, claim your work, and complete it. Task context: $TASK_DESC"

if command -v tmux &>/dev/null && [ -n "$TMUX" ]; then
  tmux split-window -h -- copilot -a teammate -m "$MODEL" "$PROMPT"
  tmux select-layout tiled
  echo "Spawned $AGENT_ID in tmux pane (model: $MODEL)"
else
  echo "NOT_IN_TMUX"
fi
```

### Model Resolution

1. **4th argument** — per-teammate override
2. **`$TEAMMATE_MODEL` env var** — set once for all teammates
3. **Default** — `claude-sonnet-4-6`

### Tmux Detection

- Checks both `tmux` binary (`command -v tmux`) and `$TMUX` env var (must be inside a session)
- Returns `NOT_IN_TMUX` so the team lead knows to fall back to the `agent` tool
- Uses `split-window -h` + `select-layout tiled` for auto-balanced panes

## Agent Changes

### team-lead.agent.md

Update step 4 (spawning) to a two-path approach:

1. Try `bash scripts/spawn-teammate.sh <team_id> <agent_id> "<task_desc>" [model]`
2. If output is `NOT_IN_TMUX`, fall back to the `agent` tool with the same prompt

The `agent` tool remains in the tools list as the fallback path.

### teammate.agent.md

- Add `agent` to the tools list (enables nested spawning — teammates can spawn their own sub-teammates via either tmux or the agent tool fallback)

## Skill Changes

### skills/team-start/SKILL.md

Add two lines hinting about tmux and model customization:
- "Run inside a tmux session for parallel teammates with live progress."
- "Set `TEAMMATE_MODEL` to customize the model (default: claude-sonnet-4-6)."

## What Does NOT Change

- **MCP server** — no new tools, no schema changes, no process management
- **SQLite database** — no new tables
- **Hooks** — unchanged
- **Teammate workflow** — register, claim, work, report. Same regardless of spawn method.
- **Coordination model** — polling via `get_messages`, monitoring via `team_status`

## Files Changed

| File | Change |
|------|--------|
| `scripts/spawn-teammate.sh` | New — tmux spawn with fallback |
| `agents/team-lead.agent.md` | Update spawn workflow |
| `agents/teammate.agent.md` | Add `agent` to tools list |
| `skills/team-start/SKILL.md` | Add tmux/model hints |

## Key Principles

- **MCP stays clean** — coordination only, no process lifecycle
- **Graceful degradation** — tmux when available, `agent` tool otherwise
- **User visibility** — tmux panes let users watch and interact with teammates
- **Nested spawning** — teammates can spawn sub-teammates via either path
- **Model flexibility** — configurable per-teammate, per-session, or global default
