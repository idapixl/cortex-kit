---
name: cortex-review
description: Code and design review grounded in persistent memory — compares new work against accumulated knowledge and patterns
---

# Cortex Review

Review code, designs, or proposals by comparing them against your accumulated knowledge in cortex.

## Workflow

### 1. Ground in memory

Before reading the work under review, query cortex for the topic:

```
query("the domain or system being reviewed")
```

Read the results. They contain past decisions, patterns, and lessons learned that inform your review.

### 2. Review against context

As you read the work, compare it against what cortex returned:

- **Does it align** with established patterns and past decisions?
- **Does it diverge** from known approaches — intentionally or accidentally?
- **Does it introduce** novel patterns worth capturing?

### 3. Record what you find

**New patterns:** If the work introduces something worth remembering:
```
observe("The new caching layer uses write-through with 5min TTL — effective for this read-heavy workload")
```

**Open questions:** If something isn't clear:
```
wonder("Why did they bypass the rate limiter for internal services?")
```

**Belief updates:** If the work changes your understanding:
```
believe(concept_id, "Updated understanding", "Evidence from this review")
```

### 4. Output format

```markdown
## Review — Grounded in Memory

### Aligned with known patterns
- [what matches cortex context]

### Divergences
- [what differs, with reasoning about whether intentional]

### New patterns to capture
- [novel approaches worth an observe() call]

### Open questions
- [things to wonder() about]
```

## Why This Matters

Without memory grounding, every review starts from zero. You'll miss that "we tried this approach 3 weeks ago and it caused latency spikes" or "this pattern was explicitly chosen over the alternative for compliance reasons." Cortex holds that context.
