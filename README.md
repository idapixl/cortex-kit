# cortex-engine

Persistent memory for AI agents. Open source, LLM-agnostic, works with any MCP client.

## What It Does

Most AI agents forget everything when the session ends. `cortex-engine` fixes that — it gives agents a persistent memory layer that survives across sessions, models, and runtimes.

- **Semantic memory** — store and retrieve observations, beliefs, questions, and hypotheses as interconnected nodes
- **Belief tracking** — agents hold positions that update when new evidence contradicts them
- **Dream consolidation** — batches of short-term observations compress into durable long-term memories (like biological sleep consolidation)
- **Spaced repetition (FSRS)** — memories that aren't accessed fade over time, keeping retrieval relevant
- **Embeddings** — pluggable providers (built-in, OpenAI, Vertex AI, Ollama) — no external service required by default
- **MCP server** — 25 cognitive tools (`query`, `observe`, `believe`, `wander`, `dream`, etc.) over the Model Context Protocol

The result: personality and expertise emerge from accumulated experience, not system prompts. An agent with 200 observations about distributed systems doesn't need to be told "you care about distributed systems." It just knows.

Works with Claude Code, Cursor, Windsurf, or any MCP-compatible client. Runs locally (SQLite) or in the cloud (Firestore + Cloud Run).

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

Your agent now has 25 cognitive tools. See **[docs/quick-start.md](docs/quick-start.md)** for the full 5-minute setup.

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
| `CORTEX_API_TOKEN` | Optional | Used by the `cortex-telemetry` hook to send retrieval feedback to the cortex API. Not required to run the MCP server. |

Additional variables are required depending on which providers you enable (Firestore, Vertex AI, OpenAI, etc.). See `docs/` for provider-specific configuration.

## Rules, Skills & Agents

`fozikio init` automatically installs safety rules, skills, and agent definitions from the `fozikio.json` manifest into the target workspace.

### Safety Rules (Reflex)

cortex-engine ships with [Reflex](https://github.com/Fozikio/reflex) rules — portable YAML-based guardrails that work across any agent runtime, not just Claude Code.

| Rule | Event | What It Does |
|------|-------|-------------|
| `cognitive-grounding` | `prompt_submit` | Nudges the agent to call `query()` before evaluation, design, review, or creation work |
| `observe-first` | `file_write` / `file_edit` | Warns if writing to memory directories without calling `observe()` or `query()` first |
| `note-about-doing` | `prompt_submit` | Suggests capturing new threads of thought with `thread_create()` |

Rules live in `reflex-rules/` as standard Reflex YAML. They're portable — use them with Claude Code, Cursor, Codex, or any runtime with a Reflex adapter. See [@fozikio/reflex](https://github.com/Fozikio/reflex) for the full rule format and tier enforcement.

**Claude Code users** also get platform-specific hooks (in `hooks/`) for telemetry, session lifecycle, and project board gating. These are runtime adapters, not rules — they handle side effects that the declarative rule format doesn't cover.

**To customize:** Edit the YAML rule files directly, or set `allow_disable: true` and disable them via Reflex config.

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
2. Copies hooks, skills, and Reflex rules into the target workspace
3. Missing source files are skipped with a warning — init never fails due to missing assets

## Plugin Ecosystem

cortex-engine ships with 25 cognitive tools out of the box. Plugins add more:
[Fozikio Plugin Docs](https://www.fozikio.com/products/plugins/)

| Plugin | What It Adds |
|--------|-------------|
| [@fozikio/tools-threads](https://github.com/Fozikio/tools-threads) | Thought threads — create, update, resolve ongoing lines of thinking |
| [@fozikio/tools-journal](https://github.com/Fozikio/tools-journal) | Session journaling — structured reflections that persist |
| [@fozikio/tools-content](https://github.com/Fozikio/tools-content) | Content pipeline — draft, review, publish workflow |
| [@fozikio/tools-evolution](https://github.com/Fozikio/tools-evolution) | Identity evolution — track how the agent's personality changes over time |
| [@fozikio/tools-social](https://github.com/Fozikio/tools-social) | Social cognition — interaction patterns, engagement tracking |
| [@fozikio/tools-graph](https://github.com/Fozikio/tools-graph) | Graph analysis — memory connections, clustering, visualization data |
| [@fozikio/tools-maintenance](https://github.com/Fozikio/tools-maintenance) | Memory maintenance — cleanup, deduplication, health checks |
| [@fozikio/tools-vitals](https://github.com/Fozikio/tools-vitals) | Vitals tracking — agent health metrics and operational signals |
| [@fozikio/tools-reasoning](https://github.com/Fozikio/tools-reasoning) | Cognitive reasoning — abstraction, contradiction detection, surfacing |

Install any plugin: `npm install @fozikio/tools-threads` — cortex-engine auto-discovers and loads installed plugins.

## Related Projects

- [@fozikio/reflex](https://github.com/Fozikio/reflex) — Portable safety guardrails for agents. Rules as data, not code.
- [sigil](https://github.com/Fozikio/sigil) — Agent control surface. Signals and gestures, not conversations.
- [fozikio.com](https://www.fozikio.com) — Documentation and guides.
- [reddit.com/r/fozikio](https://www.reddit.com/r/Fozikio/) — Connect

## License

MIT — see [LICENSE](LICENSE)
