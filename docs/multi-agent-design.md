---
date: 2026-03-14
type: design
status: active
tags: [multi-agent, cli, mcp, namespaces]
---

# Multi-Agent CLI Design

cortex-engine multi-agent support: `fozikio agent` subcommand tree, `--agent` flag on serve, and multi-agent `.mcp.json` generation.

## agent.yaml Schema

### Extended multi-agent shape

```yaml
agent:
  name: my-workspace
  version: "1.0"

agents:
  researcher:
    namespace: researcher
    profile: agents/researcher/profile.md
    description: "Research and knowledge synthesis agent"
  trader:
    namespace: trader
    profile: agents/trader/profile.md
    description: "Market analysis and trading signals agent"

cortex:
  researcher:
    store: sqlite
    embed: ollama
    primary: true
  trader:
    store: sqlite
    embed: ollama
    primary: false
```

## Commands

### `fozikio agent add <name>`

1. Validates name (`^[a-z][a-z0-9_-]{0,62}$`)
2. Adds `agents.<name>` entry to agent.yaml
3. Adds `cortex.<namespace>` entry with `collections_prefix: "<namespace>_"`
4. Creates `.fozikio/agents/<name>/profile.md`

### `fozikio agent list`

Shows all agents, their namespaces, primary status, profile path.

### `fozikio agent generate-mcp`

Writes `.mcp.json` with one server per agent:
```json
{
  "mcpServers": {
    "cortex-researcher": {
      "command": "npx",
      "args": ["fozikio", "serve", "--agent", "researcher"]
    }
  }
}
```

### `fozikio serve --agent <name>`

Scopes all tools to that agent's namespace by default. Cross-namespace queries still work via explicit `namespace` parameter.

## Implementation — Files

### Create
- `src/bin/agent-cmd.ts` — agent subcommand tree
- `src/bin/config-utils.ts` — shared path utilities

### Modify
- `src/bin/cli.ts` — add `agent` case, `--agent` on serve
- `src/bin/config-loader.ts` — `loadConfig(cwd?, agentName?)` agent scoping
- `src/bin/serve.ts` — parse `--agent` flag
- `src/bin/init.ts` — emit empty `agents: {}` block
- `src/core/config.ts` — add `AgentEntry` interface

## Build Sequence

### Phase 1 — Config layer
- Add `AgentEntry` + `agents?` to config types
- Upgrade config-loader to build full namespace map
- Add `agentName?` parameter to `loadConfig`

### Phase 2 — Serve binary
- Parse `--agent` in cli.ts and serve.ts
- Pass to `loadConfig`

### Phase 3 — Agent subcommand
- Create agent-cmd.ts
- Implement add, list, generate-mcp
- Wire into cli.ts

### Phase 4 — Init alignment
- Empty `agents: {}` in template
- Update docs references

### Phase 5 — Documentation
- Update quick-start, agent-first-setup
- Update COGNITIVE_TOOLS_REFERENCE

## Key Decisions

- **Config-loader carries scoping** — server stays clean, works for both `fozikio serve` and `cortex-engine` paths
- **`agents:` and `cortex:` are separate blocks** — identity registry vs infrastructure concern
- **`collections_prefix` derived as `"<namespace>_"`** — prevents table/collection collisions in multi-agent SQLite/Firestore
- **`generate-mcp` is explicit** — don't auto-overwrite .mcp.json on `agent add`
