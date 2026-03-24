# Quick Start

Get a working AI memory system in 5 minutes.

## 1. Install

```bash
npm install @fozikio/cortex-engine
```

## 2. Initialize a workspace

```bash
npx fozikio init my-agent
cd my-agent
```

This creates:
- `.fozikio/` — agent identity and config
- `.mcp.json` — MCP server config (ready for Claude Code)
- `CLAUDE.md` / `AGENTS.md` — tool reference for your AI agent

## 3. Start the MCP server

```bash
npx @fozikio/cortex-engine
```

The server runs on stdio. Your MCP client (Claude Code, Cursor, etc.) connects via `.mcp.json`.

**Or** start it manually via the CLI:

```bash
npx fozikio serve
```

## 4. Connect your AI agent

If using Claude Code, it auto-detects `.mcp.json`. Otherwise, add this to your MCP client config:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["@fozikio/cortex-engine"]
    }
  }
}
```

## 5. Use it

Your agent now has 57 cognitive tools. The basics:

```
query("what do I know about authentication?")   # search memories
observe("The API uses JWT tokens with 1h expiry")  # record a fact
wonder("Should we switch to session-based auth?")  # record a question
recall()                                            # see recent observations
dream()                                             # consolidate into long-term memory
```

That's it. Read before you write. Tool descriptions guide the rest.

## Configuration

Edit `.fozikio/agent.yaml` to change:

| Setting | Options | Default |
|---------|---------|---------|
| Storage | `sqlite`, `firestore` | `sqlite` |
| Embeddings | `built-in`, `ollama`, `vertex`, `openai` | `built-in` |
| LLM | `ollama`, `gemini`, `anthropic`, `openai`, `kimi` | `ollama` |

```bash
npx fozikio config --store sqlite --embed ollama --llm ollama

# Use Kimi (Moonshot AI) — set MOONSHOT_API_KEY in your environment
npx fozikio config --llm kimi
```

## Local defaults

Out of the box, cortex-engine uses **SQLite** (local file) and **built-in** embeddings (no external model needed). No cloud accounts required.

To use Ollama instead, install it from [ollama.com](https://ollama.com), pull an embedding model, and set `--embed ollama`:

```bash
ollama pull nomic-embed-text
npx fozikio config --embed ollama
```

## Long-context dream consolidation

If you're using a large-context model (Kimi, Gemini 2.5 Pro), enable the long-context dream strategy for significantly better edge discovery and abstraction:

```yaml
# .fozikio/agent.yaml
llm: kimi
llm_options:
  kimi_model: kimi-k2-0711-preview
```

Then pass `strategy: long-context` when calling `dream()`, or set it in your agent config. Instead of N² pairwise LLM calls (capped at 15 memories), the engine makes a single call with the full memory graph visible — the model can find transitive patterns and cross-domain connections that the sequential approach misses.

## Next steps

- Build custom plugins: see [Plugin Authoring](https://github.com/Fozikio/cortex-engine/wiki/Plugin-Authoring) — all Fozikio tools are built-in as of v1.0.0
- Run `dream()` periodically to consolidate observations into memories
- Use `ops_append()` for session tracking across conversations
