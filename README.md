# cortex-engine

Cognitive engine for AI agents — semantic memory, observations, embeddings, dream consolidation. Cloud Run service + MCP tools.

## What It Does

`cortex-engine` is a portable TypeScript service that gives AI agents persistent, structured memory. It handles:

- **Semantic memory graph** — store and retrieve observations as interconnected nodes
- **Embeddings** — vector representations via pluggable providers (OpenAI, Vertex AI, Anthropic)
- **Dream consolidation** — background process that reinforces and connects memories over time
- **FSRS scheduling** — spaced-repetition scheduling for memory retention
- **MCP server** — exposes cognitive tools (`query`, `observe`, `believe`, `wander`, etc.) over the Model Context Protocol

Runs as a standalone Cloud Run service or embedded in any Node.js environment.

## Architecture

| Module | Role |
|--------|------|
| `core` | Foundational types, config, and shared utilities |
| `engines` | Cognitive processing: memory consolidation, FSRS, graph traversal |
| `stores` | Persistence layer — SQLite (local) and Firestore (cloud) |
| `mcp` | MCP server and tool definitions |
| `cognitive` | Higher-order cognitive operations (dream, wander, validate) |
| `triggers` | Scheduled and event-driven triggers |
| `bridges` | Adapters for external services and APIs |
| `providers` | Embedding provider implementations |
| `bin` | Entry points: `serve.js` (HTTP + MCP), `cli.js` (admin CLI) |

## Quick Start

```bash
npm install cortex-engine
npx fozikio init my-agent
cd my-agent
npx cortex-engine   # starts MCP server
```

Your agent now has 17 cognitive tools. See **[docs/quick-start.md](docs/quick-start.md)** for the full 5-minute setup.

### Multi-Agent

```bash
npx fozikio agent add researcher --description "Research agent"
npx fozikio agent add trader --description "Trading signals"
npx fozikio agent generate-mcp   # writes .mcp.json with scoped servers
```

Each agent gets isolated memory via namespaces. See **[docs/multi-agent-design.md](docs/multi-agent-design.md)** for architecture details.

### Agent-First Setup

The fastest path: open an AI agent in an empty directory and say *"set up a cortex workspace."* The agent runs `npx fozikio init`, reads the generated files, and is immediately productive. See **[docs/agent-first-setup.md](docs/agent-first-setup.md)** for the full guide.

### Development

```bash
npm run dev       # tsc --watch
npm test          # vitest run
npm run test:watch
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CORTEX_API_TOKEN` | Yes | Authentication token for the HTTP API |

Additional variables are required depending on which providers you enable (Firestore, Vertex AI, OpenAI, etc.). See `docs/` for provider-specific configuration.

## Hooks, Skills & Agents

`fozikio init` automatically installs hooks, skills, and agent definitions from the `fozikio.json` manifest into the target workspace. These live in `.claude/hooks/` and `.claude/skills/` after init.

### Hooks

Hooks are shell scripts that integrate into Claude Code's event system. They fire automatically — no agent action required.

| Hook | Event | What It Does | Requires |
|------|-------|-------------|----------|
| `cognitive-grounding.sh` | `UserPromptSubmit` | Nudges the agent to call `query()` before evaluation, design, review, or creation work | — |
| `observe-first.sh` | `PreToolUse` (Write/Edit) | Warns if writing to Mind/, Journal/, or memory/ without calling `observe()` or `query()` first | — |
| `cortex-telemetry.sh` | `PostToolUse` | Tracks cortex retrieval calls and detects retries (2 calls within 60s), sends feedback to the cortex API | `CORTEX_API_URL`, `CORTEX_API_TOKEN` (optional) |
| `session-lifecycle.sh` | `SessionStart` | Resets session-scoped state files (telemetry log, push-gate state) | — |
| `project-board-gate.sh` | `PreToolUse` (Bash) | Blocks `git push` to tracked repos until board updates and/or ops logging are done | `.claude/state/project-boards.json` config |

**To disable a hook:** Delete the `.sh` file from `.claude/hooks/`. No other config changes needed.

**To customize project-board-gate:** Create `.claude/state/project-boards.json` with your repos and requirements:

```json
{
  "enabled": true,
  "strength": "block",
  "on_push": {
    "require_board_update": true,
    "require_ops_log": false
  },
  "repos": {
    "my-repo": {
      "board_number": 5,
      "board_owner": "my-org",
      "description": "My project"
    }
  }
}
```

Set `"strength": "off"` to disable the gate without removing the hook.

### Skills

Skills are invocable workflows that agents can use via `/skill-name`.

| Skill | When to Use | What It Provides |
|-------|-------------|-----------------|
| `cortex-query` | Before evaluation, review, design, or creation work | Best practices for querying cortex — specificity, keyword mode, neighbor exploration, anti-patterns |
| `cortex-review` | When reviewing code, designs, or proposals | A structured review workflow that grounds feedback in cortex memory, with a standard output format |

### Agents

| Agent | Description |
|-------|-------------|
| `cortex-researcher` | Deep research agent that queries cortex before external sources, observes novel findings back into memory |

### How Auto-Install Works

1. `fozikio init` reads `fozikio.json` from the package root
2. For each hook in `contents.hooks`: copies `hooks/{name}.sh` into `{workspace}/.claude/hooks/`
3. For each skill in `contents.skills`: copies `skills/{name}/` directory into `{workspace}/.claude/skills/`
4. Missing source files are skipped with a warning — init never fails due to missing assets

### Overriding Cortex Hooks

To override a hook's behavior without removing it:
1. Edit the `.sh` file in your workspace's `.claude/hooks/` directly — it's a plain copy, not a symlink
2. Re-running `fozikio init --here` will overwrite your changes (it copies fresh from the package)
3. To preserve customizations across re-init, rename the hook file (hooks are matched by filename in Claude Code settings, not by the fozikio manifest)

## Related Projects


## License

MIT — see [LICENSE](LICENSE)
