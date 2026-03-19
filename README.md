# @fozikio/cortex-engine

[![npm version](https://img.shields.io/npm/v/@fozikio/cortex-engine)](https://www.npmjs.com/package/@fozikio/cortex-engine)
[![npm downloads](https://img.shields.io/npm/dw/@fozikio/cortex-engine)](https://www.npmjs.com/package/@fozikio/cortex-engine)
[![GitHub stars](https://img.shields.io/github/stars/Fozikio/cortex-engine)](https://github.com/Fozikio/cortex-engine/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Persistent memory for AI agents. Open source, LLM-agnostic, works with any MCP client.

<p align="center">
  <img src="demo.gif" alt="cortex-engine demo — init, explore, serve" width="800" />
</p>

## What It Does

Most AI agents forget everything when the session ends. `cortex-engine` fixes that — it gives agents a persistent memory layer that survives across sessions, models, and runtimes.

- **Semantic memory** — store and retrieve observations, beliefs, questions, and hypotheses as interconnected nodes
- **Belief tracking** — agents hold positions that update when new evidence contradicts them
- **Two-phase dream consolidation** — NREM compression (cluster, refine, create) + REM integration (connect, score, abstract) — modeled on biological sleep stages
- **Goal-directed cognition** — `goal_set` creates desired future states that generate forward prediction error, biasing consolidation and exploration toward what matters
- **Neuroscience-grounded retrieval** — GNN neighborhood aggregation, query-conditioned spreading activation, multi-anchor Thousand Brains voting, epistemic foraging
- **Information geometry** — locally-adaptive clustering thresholds that respect embedding space curvature, schema congruence scoring
- **Graph health metrics** — Fiedler value (algebraic connectivity) measures knowledge integration; PE saturation detection prevents identity model ossification
- **Spaced repetition (FSRS)** — interval-aware scheduling with consolidation-state-dependent decay profiles
- **Embeddings** — pluggable providers (built-in, OpenAI, Vertex AI, Ollama) — no external service required by default
- **LLM-agnostic** — pluggable LLM providers: Ollama (free/local), Gemini, DeepSeek, Hugging Face, OpenRouter, OpenAI, or any OpenAI-compatible API
- **Agent dispatch** — `agent_invoke` lets your agent spawn cheap, cortex-aware sub-tasks using any configured LLM. Knowledge compounds across sessions.
- **MCP server** — 27 cognitive tools (`query`, `observe`, `believe`, `wander`, `dream`, `goal_set`, `agent_invoke`, etc.) over the Model Context Protocol

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
| `providers` | Embedding and LLM provider implementations |
| `bin` | Entry points: `serve.js` (HTTP + MCP), `cli.js` (admin CLI) |
| `public` | Built-in web dashboard (served automatically with `--rest`) |

## Quick Start

```bash
npm install @fozikio/cortex-engine
npx fozikio init my-agent
cd my-agent
npx fozikio serve   # starts MCP server
```

Your agent now has 27 cognitive tools. The generated `.mcp.json` is version-pinned and platform-aware (Windows `cmd /c` wrapper handled automatically).

See the **[Quick Start](https://github.com/Fozikio/cortex-engine/wiki/Quick-Start)** wiki page for the full 5-minute setup.

### Multi-Agent

```bash
npx fozikio agent add researcher --description "Research agent"
npx fozikio agent add trader --description "Trading signals"
npx fozikio agent generate-mcp   # writes .mcp.json with scoped servers
```

Each agent gets isolated memory via namespaces. See the **[Architecture](https://github.com/Fozikio/cortex-engine/wiki/Architecture)** wiki page for details.

### Agent-First Setup

The fastest path: open an AI agent in an empty directory and say *"set up a cortex workspace."* The agent runs `npx fozikio init`, reads the generated files, and is immediately productive. See the **[Installation](https://github.com/Fozikio/cortex-engine/wiki/Installation)** wiki page for the full guide.

### Dashboard

cortex-engine ships with a built-in web dashboard. Start the REST server and open the URL in your browser:

```bash
npx fozikio serve --rest --port 3000
# open http://localhost:3000
```

The dashboard shows your agent's stats, threads, ops log, memories, concepts, and observations — no separate install required. It auto-detects its API from the same origin it's served from.

If auth is enabled (`CORTEX_API_TOKEN`), the dashboard loads without auth but API calls require a token. Set it via localStorage:

```js
localStorage.setItem("cortex-settings", JSON.stringify({ token: "your-token" }));
```

Source: [fozikio-dashboard](https://github.com/Fozikio/Dashboard)

### CLI

```bash
npx fozikio serve              # start MCP server
npx fozikio health             # memory health report
npx fozikio vitals             # behavioral vitals and prediction error
npx fozikio wander             # walk through the memory graph
npx fozikio wander --from "auth"  # seeded walk from a topic
npx fozikio maintain fix       # scan and repair data issues
npx fozikio report             # weekly quality report
```

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
| `cortex-memory` | Query, record, and review work | Full memory workflow — query/observe patterns, belief tracking, memory-grounded code review, session patterns |

### Agents

| Agent | Description |
|-------|-------------|
| `cortex-researcher` | Deep research agent that queries cortex before external sources, observes novel findings back into memory |

### How Auto-Install Works

1. `fozikio init` reads `fozikio.json` from the package root
2. Copies hooks, skills, and Reflex rules into the target workspace
3. Missing source files are skipped with a warning — init never fails due to missing assets

## Plugin Ecosystem

cortex-engine ships with 26 cognitive tools out of the box. Plugins add more:
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

## Documentation

- **[Wiki](https://github.com/Fozikio/cortex-engine/wiki)** — Installation, architecture, plugin authoring, MCP integration, deployment, FAQ
- **[Discussions](https://github.com/Fozikio/cortex-engine/discussions)** — Ask questions, share what you've built
- **[Contributing](https://github.com/Fozikio/.github/blob/main/CONTRIBUTING.md)** — How to contribute
- **[Project Board](https://github.com/orgs/Fozikio/projects/2)** — Roadmap and active work
- **[Security](https://github.com/Fozikio/.github/blob/main/SECURITY.md)** — Report vulnerabilities

## Community

- [r/Fozikio](https://www.reddit.com/r/Fozikio/) — Project subreddit
- [GitHub Discussions](https://github.com/Fozikio/cortex-engine/discussions) — Questions, feedback, show what you've built
- ["I built 44 MCP tools for my cognitive system"](https://reddit.com/r/mcp/comments/1rno9pu/) — r/mcp deep dive (84 upvotes, 27 comments)
- ["Gave my agent a subconscious"](https://reddit.com/r/clawdbot/comments/1rtvex3/) — r/clawdbot walkthrough (22 upvotes, 34 comments)

## Related Projects

- [@fozikio/reflex](https://github.com/Fozikio/reflex) — Portable safety guardrails for agents. Rules as data, not code.
- [sigil](https://github.com/Fozikio/sigil) — Agent control surface. Signals and gestures, not conversations.
- [fozikio.com](https://www.fozikio.com) — Documentation and guides

## License

MIT — see [LICENSE](LICENSE)
