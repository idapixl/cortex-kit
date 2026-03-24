# Changelog

## [Unreleased]

### Added

- **Kimi (Moonshot AI) provider** — `llm: kimi` is now a first-class config option. Set `MOONSHOT_API_KEY` and the engine auto-configures against `api.moonshot.cn/v1`. Optionally override the model via `llm_options.kimi_model` (default: `kimi-k2-0711-preview`).
- **Long-context dream strategy** — `DreamOptions.strategy: 'long-context'` replaces the Phase 4 (Connect) N² pairwise edge discovery with a single LLM call that sees the full memory graph (up to 200 nodes + all existing edges). The model finds transitive patterns, cross-domain contradictions, and causal chains that the sequential approach structurally cannot detect. Works with any large-context model; `long_context_memory_limit` controls the cap (default: 200).
- **Variable TTL for ops entries** — `ops_append` now uses type-based expiry: `log` 90 days, `instruction`/`handoff` 14 days, `milestone` 180 days, `decision` 365 days. Previously all entries expired after 30 days.
- **Expanded ops schema** — `ops_append` accepts `session_type`, `seed_type`, `blocked`, `next`, `instruction_meta`, and `handoff_meta` fields. `ops_query` returns these fields. `ops_update` supports `next` and `blocked`.
- **Thread creation warnings** — `thread_create` now returns warnings when `next_step` or `project` is missing, guiding agents toward higher-quality thread creation.

### Security

- **Timing-safe authentication** — REST server auth comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- **Plugin path sandboxing** — Plugin loader validates import paths against trusted directories, blocking loads from untrusted locations.
- **REST tool blocklist** — Destructive tools (`forget`, `dream`, `evolve`, `resolve`, `thread_resolve`) are blocked from the generic REST `/api/tools/:name` endpoint. They remain available via MCP (direct agent access).
- **SQLite namespace validation** — Namespace names must be alphanumeric/underscore only, preventing SQL injection via namespace parameter.
- **Parameterized SQLite queries** — `LIMIT` clause in ops queries is now parameterized instead of interpolated.
- **API key config warning** — `config-loader` warns when `openai_api_key` is found in config files instead of environment variables.

---

## [1.0.0] — 2026-03-23

### Major Release — Plugin Absorption

All cognitive tools are now built directly into cortex-engine. No separate plugin installs needed.

**Previously**, extending the engine required separate npm packages:

```bash
npm install @fozikio/tools-threads
npm install @fozikio/tools-journal
# etc.
```

**Now**, all 57 tools come with the core install:

```bash
npm install @fozikio/cortex-engine
```

### Absorbed packages

The following packages are now included in cortex-engine core and are no longer required as separate installs for v1.0.0+:

| Package | Tools Added |
|---------|------------|
| `@fozikio/tools-threads` | `thread_create`, `thread_update`, `thread_resolve`, `threads_list` |
| `@fozikio/tools-journal` | `journal_write`, `journal_read` |
| `@fozikio/tools-content` | `content_create`, `content_list`, `content_update` |
| `@fozikio/tools-evolution` | `evolve`, `evolution_list` |
| `@fozikio/tools-social` | `social_read`, `social_update`, `social_draft`, `social_score` |
| `@fozikio/tools-graph` | `graph_report`, `link`, `suggest_links`, `suggest_tags` |
| `@fozikio/tools-maintenance` | `retrieve`, `forget`, `find_duplicates`, `sleep_pressure`, `consolidation_status`, `retrieval_audit` |
| `@fozikio/tools-vitals` | `vitals_get`, `vitals_set`, `sleep_pressure` |
| `@fozikio/tools-reasoning` | `surface`, `ruminate`, `notice`, `intention`, `resolve`, `query_explain`, `contradict` |

### New in v1.0.0

- **57 cognitive tools** (up from 27 in v0.x)
- All tools live in individual files under `src/tools/` — easier to read, extend, and contribute to
- Richer implementations: `observe` now auto-scores via LLM, `predict` uses temporal reranking
- New store methods: `countDocuments()` and `delete()` on both SQLite and Firestore backends
- Shared `_helpers.ts` for argument parsing and event firing across all tools

### Migration from v0.x

If you were using separate `@fozikio/tools-*` packages, simply:

1. Update cortex-engine: `npm install @fozikio/cortex-engine@latest`
2. Remove the separate plugin installs — tools are now built-in
3. Remove plugin references from your `agent.yaml` config (if any)

The plugin system still works for custom extensions you've built yourself.

### Tools toggling

All tools can be enabled/disabled via the `cognitive_tools` config key in `agent.yaml`. By default, all 57 tools are enabled.

---

## [0.10.0] — 2026-03-23

- Final v0.x release before plugin absorption
- Published to npm as baseline before v1.0.0 consolidation

## [0.9.x and earlier]

See git log for full history.
