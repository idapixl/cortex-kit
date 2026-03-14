---
date: 2026-03-12
type: spec
status: active
---

# Cortex Document Frontmatter Specification

The cortex document frontmatter is a YAML contract that makes any markdown file cortex-aware. It works identically across Obsidian (Meta Bind controls), the Fozikio dashboard (web UI), CLI (`fozikio digest`), file watchers, and custom integrations.

## Required Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `title` | string | — | Document title |
| `date_created` | date | YYYY-MM-DD | When the document was created |
| `last_updated` | date | YYYY-MM-DD | When the document was last modified |
| `type` | enum | `reference`, `plan`, `idea`, `note`, `decision`, `research`, `creative`, `workshop` | Document category |
| `status` | enum | `active`, `pending`, `processing`, `digested`, `archived`, `forgotten` | Lifecycle state (system-managed) |
| `directive` | enum | `review`, `digest`, `forget` | User intent (user-managed) |
| `post_digest` | enum | `keep`, `archive`, `trash` | What happens to the file after digestion |
| `tags` | string[] | — | Categorization tags |

## Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | enum | `manual` | Where the content came from: `manual`, `session`, `import`, `cron` |
| `namespace` | string | `default` | Which cortex namespace to target for digestion |
| `digest_pipeline` | string | `default` | Pipeline preset or custom pipeline name |
| `digest_result` | object | null | Populated after processing (see below) |

## Directive → Status Flow

```
User sets directive    System updates status    System action
─────────────────────  ──────────────────────   ─────────────
directive: review      status: active           No action (default)
directive: digest      status: pending          Queue for processing
                       status: processing       Pipeline running
                       status: digested         Pipeline complete
                       (if post_digest=archive) status: archived, file moved
                       (if post_digest=trash)   status: forgotten, file moved
                       (if post_digest=keep)    status: digested, file stays
directive: forget      status: forgotten        Skip cortex, apply post_digest action
```

## Pipeline Presets

| Preset | Steps | Best For |
|--------|-------|----------|
| `default` | observe, reflect | Most documents — captures content and generates insights |
| `deep` | observe, reflect, predict | Plans, decisions, research — also extracts forward-looking claims |
| `observe-only` | observe | Quick capture — just index the content without generating insights |

Custom pipelines can be defined in `.fozikio/config.yaml` under `digest_pipelines`.

## digest_result Schema

Populated by the system after processing. Never set manually.

```yaml
digest_result:
  processed_at: 2026-03-12T14:30:00Z
  observation_ids:
    - "obs_abc123"
    - "obs_def456"
  memories_linked:
    - "mem_xyz789"
  insights:
    - "Connected to existing memory about prediction markets"
    - "Contradicts earlier belief about embedding quality"
  pipeline_executed:
    - observe
    - reflect
  duration_ms: 2340
```

## Consumption Paths

### Obsidian (Meta Bind)
Template at `System/Templates/Templates/Cortex Document.md`. Uses `INPUT[inlineSelect]` for directive/post_digest/type/namespace, `VIEW` for status/dates. File watcher or manual trigger processes pending files.

### Fozikio Dashboard
Content view lists all cortex-aware files with lifecycle state. Bulk actions: "Digest selected", "Archive digested". Calls cortex REST API `POST /api/digest`.

### CLI
```bash
fozikio digest path/to/file.md              # Digest one file
fozikio digest --pending                     # Digest all with directive: digest
fozikio digest --pending --dry-run           # Show what would be processed
fozikio forget path/to/file.md              # Mark forgotten, apply post_digest
fozikio status                               # Show undigested file count
```

### File Watcher
```bash
fozikio watch [path]                        # Background daemon
```
Monitors YAML frontmatter changes. When `directive` changes to `digest`, queues processing. Configurable in `.fozikio/config.yaml`:

```yaml
digest:
  watch_paths: ["./"]
  auto_process: true        # Process immediately on directive change
  poll_interval_ms: 5000    # Frontmatter check interval
```

### REST API
```
POST /api/digest
{
  "content": "# My Document\n\nContent here...",
  "source_file": "Knowledge/my-doc.md",
  "namespace": "default",
  "pipeline": ["observe", "reflect"]
}

Response:
{
  "observation_ids": ["..."],
  "memories_linked": ["..."],
  "insights": ["..."],
  "pipeline_executed": ["observe", "reflect"],
  "processed_at": "2026-03-12T14:30:00Z",
  "duration_ms": 2340
}
```

## Extending the Type System

The `type` enum is intentionally open. fozikio users can add custom types in their config:

```yaml
digest:
  custom_types:
    - meeting-notes
    - retrospective
    - daily-standup
```

Custom types get the same lifecycle and pipeline support as built-in types.
