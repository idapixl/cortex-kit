---
name: cortex-query
description: Persistent memory for AI agents — search, record, and build knowledge across sessions using cortex-engine MCP tools
---

# Cortex Memory — Query & Record

Your agent has persistent memory via cortex-engine. Knowledge survives across sessions — you can recall what you learned last week, track evolving beliefs, and build a knowledge graph over time.

## Core Loop

**Read before you write.** Always check what you already know before adding more.

### Search for knowledge

```
query("authentication architecture decisions")
```

Be specific. `query("JWT token expiry policy")` beats `query("auth")`. Results include relevance scores and connected concepts.

After finding a relevant memory, explore around it:
```
neighbors(memory_id)
```

### Record what you learn

**Facts** — things you confirmed or noticed to be true:
```
observe("The API rate limits at 1000 req/min per API key, not per user")
```

**Questions** — things you want to explore but haven't resolved:
```
wonder("Why does the sync daemon stall after 300k seconds?")
```

**Hypotheses** — ideas that might be true but aren't confirmed:
```
speculate("Switching to connection pooling might fix the timeout issues")
```

These are stored separately so questions don't pollute your knowledge base.

### Update beliefs

When your understanding changes:
```
believe(concept_id, "Revised understanding based on new evidence", "reason for change")
```

### Track work across sessions

```
ops_append("Finished auth refactor, tests passing", project="api-v2")
```

Next session, pick up where you left off:
```
ops_query(project="api-v2")
```

## Session Pattern

1. **Start:** `query()` the topic you're working on
2. **During:** `observe()` facts, `wonder()` questions as they come up
3. **End:** `ops_append()` what you did and what's unfinished
4. **Periodically:** `dream()` to consolidate observations into long-term memories

## Available Tools

**Write:** observe, wonder, speculate, believe, reflect, digest
**Read:** query, recall, predict, validate, neighbors, wander
**Ops:** ops_append, ops_query, ops_update
**System:** stats, dream

## Setup

```bash
npm install cortex-engine
npx fozikio init my-agent
npx cortex-engine  # starts MCP server
```

Defaults to local SQLite + Ollama. No cloud accounts needed.
