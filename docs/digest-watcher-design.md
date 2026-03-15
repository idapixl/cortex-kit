---
date: 2026-03-12
type: spec
status: draft
---

> **Status: Not yet implemented.** This is a design document for a planned `fozikio watch` command. The feature does not exist yet. Use `fozikio digest <file>` for manual invocation.

# Digest File Watcher — Design Brief

## Problem

The digest pipeline exists (`digestDocument()` in cortex-engine, `fozikio digest` CLI) but requires manual invocation. Users set `directive: digest` in frontmatter via Obsidian's Meta Bind toolbar, then... nothing happens. There's no automated trigger.

## Goal

When a user sets `directive: digest` in a markdown file's frontmatter, automatically run the digest pipeline and update `status: digested` + execute `post_digest` action.

## Approach Options

### Option A: chokidar daemon (Recommended)

A Node.js process using chokidar to watch a configured directory for `.md` file changes. On change, parse frontmatter — if `directive: digest` and `status != digested`, run the pipeline.

**Pros:**
- Simple, well-understood (chokidar is battle-tested)
- Works with any editor (Obsidian, VS Code, Cursor, vim)
- Can run as systemd service on VPS or Windows service locally
- Already have the pattern from local-watcher in Infra/

**Cons:**
- Separate process to manage
- Polls on some platforms (native fs events on most)

**Implementation:**
```
src/watchers/digest-watcher.ts
  - chokidar.watch(config.watchDir, { ... })
  - On 'change' event: read file, parse frontmatter
  - If directive === 'digest' && status !== 'digested' && status !== 'processing':
    1. Set status: 'processing' in frontmatter (prevent re-entry)
    2. Run digestDocument(content, store, embed, llm, options)
    3. Set status: 'digested', clear directive
    4. Execute post_digest action (keep/archive/trash)
    5. Log to ops
```

### Option B: Obsidian plugin

A custom Obsidian plugin that hooks into file save events and triggers digest.

**Pros:**
- Native Obsidian integration
- No separate process

**Cons:**
- Obsidian-only (won't work with VS Code, CLI workflows)
- Plugin development is more complex
- Requires Obsidian running

**Verdict:** Too narrow. We're editor-agnostic.

### Option C: Git hook (post-commit)

Check staged files for `directive: digest` in a post-commit hook.

**Pros:**
- Zero daemon overhead
- Already have hook infrastructure

**Cons:**
- Only triggers on commit, not on save
- Latency between intent and action
- Weird UX — "I set digest but nothing happened until I committed"

**Verdict:** Too delayed. Digest should feel immediate.

### Option D: fozikio watch subcommand

Add a `fozikio watch <dir>` command that combines the CLI with the watcher.

**Pros:**
- Single tool (CLI + watcher in one)
- `fozikio watch ./notes` is a clean developer experience

**Cons:**
- None significant — this is Option A packaged better

**Verdict:** This is Option A implemented as part of fozikio. Best of both worlds.

## Recommendation: Option D (fozikio watch)

### API

```bash
# Watch a directory for digest-ready files
fozikio watch ./notes

# Watch with custom config
fozikio watch ./notes --namespace myproject --pipeline deep

# Watch with polling (for network drives)
fozikio watch ./notes --poll 2000
```

### Architecture

```
fozikio watch <dir>
  └── chokidar watches dir/**/*.md
       └── on change: parseFrontmatter()
            └── if directive === 'digest':
                 ├── updateFrontmatter(status: 'processing')
                 ├── digestDocument(content, store, embed, llm)
                 ├── updateFrontmatter(status: 'digested')
                 └── executePostDigest(post_digest)
```

### Dependencies
- `chokidar` (add to cortex-engine deps, or use Node.js fs.watch with recursive flag on Node 20+)
- `yaml` (already a dependency)
- Existing: `digestDocument`, `parseFrontmatter`, store/embed/llm providers

### Debounce
- 500ms debounce on file changes (Meta Bind writes frontmatter in rapid succession)
- Skip files where `status === 'processing'` (re-entry guard)

### Error Handling
- On pipeline error: set `status: 'error'`, add `digest_error: "<message>"` to frontmatter
- User can fix the issue and set `directive: digest` again to retry

## Next Steps
1. Add chokidar to cortex-engine dependencies
2. Implement `src/watchers/digest-watcher.ts`
3. Wire into `fozikio watch` CLI command
4. Test with Obsidian Meta Bind toolbar
