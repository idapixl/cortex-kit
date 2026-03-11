---
name: cortex-query
description: Best practices for querying cortex memory
---

# Cortex Query — Skill

## When to Use
Before any evaluation, review, design, or creation work.

## How to Query

1. **Be specific:** `query("retrieval routing architecture decisions")` > `query("routing")`
2. **Query before forming opinions:** The cortex holds patterns and past mistakes you can't reconstruct from conversation context.
3. **Use keyword mode for exact matches:** `query({ text: "...", keyword: "project-name" })`
4. **Check neighbors for connected context:** After getting a result, call `neighbors(result_id)` to see the graph around it.

## Anti-Patterns

- Querying AFTER you've already written your analysis (too late to ground)
- Generic queries like "tell me about X" (too broad)
- Skipping query because "I already know this" (you don't — context is always partial)
