---
name: cortex-memory
version: 1.0.0
description: Persistent cognitive memory for AI agents — query, record, review, and consolidate knowledge across sessions with spreading activation, FSRS scheduling, and NLI contradiction detection.
author: idapixl
tags: [memory, cognition, mcp, agents, knowledge-graph, spaced-repetition, code-review, fsrs]
---

# Cortex Memory

Persistent memory engine for AI agents. Knowledge survives across sessions — recall what you learned last week, track evolving beliefs, detect contradictions, and build a knowledge graph over time.

**Source:** [github.com/Fozikio/cortex-engine](https://github.com/Fozikio/cortex-engine) (MIT) | [npm](https://www.npmjs.com/package/@fozikio/cortex-engine)

## Prerequisites

This skill requires [cortex-engine](https://github.com/Fozikio/cortex-engine) running as an MCP server. Install it separately before using this skill:

```bash
npm install @fozikio/cortex-engine@0.5.1
# Integrity: sha512-8oIL8KenrdTdACAMSM/iqyrxx04yFE/3IfHx1dTF2439ljXhSCvULcNF5V10tH8UK7P/zuwmx3RuNynvjGi4kg==
```

Then initialize and start:
```bash
npx @fozikio/cortex-engine@0.5.1 fozikio init my-agent
npx @fozikio/cortex-engine@0.5.1  # starts MCP server
```

Runs locally with SQLite + Ollama. No cloud accounts needed. The skill instructions below are read-only — they teach your agent how to use cortex tools, they don't execute anything.

## Core Loop

**Read before you write.** Always check what you already know before adding more.

### Search

```
query("authentication architecture decisions")
```

Be specific. `query("JWT token expiry policy")` beats `query("auth")`. Results include relevance scores and connected concepts.

Explore around a result:
```
neighbors(memory_id)
```

### Record

**Facts** — things you confirmed:
```
observe("The API rate limits at 1000 req/min per API key, not per user")
```

**Questions** — unresolved:
```
wonder("Why does the sync daemon stall after 300k seconds?")
```

**Hypotheses** — unconfirmed ideas:
```
speculate("Connection pooling might fix the timeout issues")
```

### Update beliefs

```
believe(concept_id, "Revised understanding based on new evidence", "reason")
```

### Track work across sessions

```
ops_append("Finished auth refactor, tests passing", project="api-v2")
ops_query(project="api-v2")  # pick up where you left off
```

## Memory-Grounded Reviews

Review code or designs by comparing against accumulated knowledge:

1. **Ground:** `query("the domain being reviewed")` — load past decisions and patterns
2. **Compare:** Does the work align with or diverge from established patterns?
3. **Record:** `observe()` new patterns, `wonder()` about unclear choices, `believe()` updated understanding
4. **Output:**

```markdown
## Review — Grounded in Memory

### Aligned with known patterns
- [matches cortex context]

### Divergences
- [what differs, intentional or accidental]

### New patterns to capture
- [novel approaches worth observing]
```

## Session Pattern

1. **Start:** `query()` the topic you're working on
2. **During:** `observe()` facts, `wonder()` questions as they come up
3. **End:** `ops_append()` what you did and what's unfinished
4. **Periodically:** `dream()` to consolidate memories (compress, abstract, prune)

## Available Tools

| Category | Tools |
|----------|-------|
| **Read** | query, recall, predict, validate, neighbors, wander |
| **Write** | observe, wonder, speculate, believe, reflect, digest |
| **Ops** | ops_append, ops_query, ops_update |
| **System** | stats, dream |
