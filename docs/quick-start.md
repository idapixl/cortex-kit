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

Your agent now has 17 cognitive tools. The basics:

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
| LLM | `ollama`, `gemini`, `anthropic`, `openai` | `ollama` |

```bash
npx fozikio config --store sqlite --embed ollama --llm ollama
```

## Local defaults

Out of the box, cortex-engine uses **SQLite** (local file) and **built-in** embeddings (no external model needed). No cloud accounts required.

To use Ollama instead, install it from [ollama.com](https://ollama.com), pull an embedding model, and set `--embed ollama`:

```bash
ollama pull nomic-embed-text
npx fozikio config --embed ollama
```

## Next steps

- Add plugins: `npm install @fozikio/tools-threads` (thread management)
- Run `dream()` periodically to consolidate observations into memories
- Use `ops_append()` for session tracking across conversations
