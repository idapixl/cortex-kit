---
date: 2026-03-16
type: spec
status: active
---

# Digest Extract Pipeline Step

## Problem

cortex-engine's memory graph contains primarily engineering observations from active work sessions. Identity-rich content (journals, creative writing, personality files, opinion pieces) exists in markdown files but was never ingested. The graph can't answer identity queries ("what do I believe?", "what frustrates me?") because it never received that content.

## Solution

New `extract` pipeline step in the existing digest engine. Uses the configured LLM to categorize document content into typed observations that route through the existing content_type system:

| Extracted Type | content_type | Description |
|---|---|---|
| belief | declarative | Positions, values, preferences, opinions |
| question | interrogative | Open questions, curiosities |
| hypothesis | speculative | Untested ideas, "what if" |
| reflection | reflective | Synthesized insights, emotional responses, patterns |
| fact | declarative | Concrete verified information |

## Usage

### CLI (backfill)

```bash
fozikio digest --dir .fozikio/workshop --all --pipeline extract
fozikio digest --dir .fozikio/journal --all --pipeline extract
fozikio digest --dir .fozikio/mind --all --pipeline extract
```

### MCP Tool

```
digest(content: "...", pipeline: ["extract"], source_file: "workshop/essay.md")
```

### Combined Pipeline

```bash
fozikio digest --dir .fozikio/workshop --all --pipeline extract,observe
```

## Implementation

- `src/engines/digest.ts`: ~80 lines — `runExtractStep()` function + pipeline wiring
- `src/bin/digest-cmd.ts`: ~10 lines — `--all` flag for batch scanning without frontmatter requirement
- No new types, no new tools, no new dependencies

## Design Decisions

- **Uses existing content_type system** rather than inventing new categories
- **PE gate skips duplicates** — `merge` results are dropped, preventing re-ingestion
- **Max 10 items per file** — prevents LLM from over-extracting
- **Salience from LLM** — the LLM assigns 0.3-0.9 salience per item, clamped to that range
- **source_section tracks type** — `digest:extract:belief`, `digest:extract:question`, etc. for provenance
- **Works with any LLM provider** — uses `generateJSON()` which all providers implement
