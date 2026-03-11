# cortex-kit

Portable agent infrastructure for cortex-powered AI agents. Install hooks, hookify rules, skills, and agent configs that wire Claude Code agents into a cortex memory system — turning any project into a cortex-grounded workspace.

## Prerequisites

- [cortex API](https://github.com/idapixl/idapixl-cortex) v0.3.0 or later
- [Claude Code](https://claude.ai/claude-code) v1.0.0 or later
- `jq` (for hooks) and `curl` (for telemetry)

## Installation

```bash
git clone https://github.com/idapixl/cortex-kit.git
cd cortex-kit
./setup.sh --target /path/to/your/project
```

On Windows:

```powershell
git clone https://github.com/idapixl/cortex-kit.git
cd cortex-kit
.\setup.ps1 -Target C:\path\to\your\project
```

## What's Included

### Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| `cognitive-grounding.sh` | UserPromptSubmit | Reminds agent to call `query()` before evaluation/design/review work |
| `observe-first.sh` | PreToolUse (Write/Edit) | Reminds agent to call `observe()` before writing to memory directories |
| `cortex-telemetry.sh` | PostToolUse | Tracks cortex retrieval tool calls; sends retry signals to cortex API |
| `session-lifecycle.sh` | SessionStart | Clears telemetry state for each new session |

### Hookify Rules

| Rule | Strength | Trigger |
|------|----------|---------|
| `hookify.cognitive-grounding.local.md` | enforce | Prompts involving evaluation/design/review |
| `hookify.observe-first.local.md` | enforce | Writes to Mind/Journal/memory directories |
| `hookify.note-about-doing.local.md` | nudge | "I should / I need to / I want to" patterns |

### Skills

- `cortex-query` — Best practices for querying cortex: specificity, timing, anti-patterns
- `cortex-review` — Review workflow grounded in cortex memory; structured output format

### Agents

- `cortex-researcher` — Deep research agent that queries cortex before external sources

## Configuration

Set these environment variables for full functionality:

```bash
CORTEX_API_URL=https://your-cortex-instance.run.app
CORTEX_API_TOKEN=your-token-here
```

The telemetry hook uses these to send retry signals back to the cortex API. Hooks work without them — telemetry is fire-and-forget.

### Registering Hooks

After installation, register the hooks in your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "bash .claude/hooks/cognitive-grounding.sh" }] }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "bash .claude/hooks/observe-first.sh" }]
      }
    ],
    "PostToolUse": [
      { "hooks": [{ "type": "command", "command": "bash .claude/hooks/cortex-telemetry.sh" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "bash .claude/hooks/session-lifecycle.sh" }] }
    ]
  }
}
```

## Updating

Since setup.sh uses symlinks for hooks and skills, updating is just a `git pull`:

```bash
cd /path/to/cortex-kit
git pull
```

On Windows (copies rather than symlinks), re-run setup.ps1 after pulling.

## License

MIT — see [LICENSE](LICENSE)
