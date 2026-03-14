/**
 * init.ts — cortex-kit init command.
 *
 * Scaffolds a new agent workspace with cortex-engine configuration.
 *
 * Usage:
 *   cortex-kit init <name> [options]
 *   cortex-kit init --here [options]
 *
 * Options:
 *   --store sqlite|firestore   Storage backend (default: sqlite)
 *   --embed ollama|vertex|openai   Embedding provider (default: ollama)
 *   --llm ollama|gemini|anthropic|openai   LLM provider (default: ollama)
 *   --namespace <name>   Default namespace name (default: default)
 *   --here   Scaffold into current directory instead of creating <name>/
 *   --obsidian   Create .obsidian/ structure
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, readdirSync, chmodSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Types ─────────────────────────────────────────────────────────────────

interface KitManifest {
  contents?: {
    hooks?: string[];
    hookify_rules?: string[];
    skills?: string[];
    agents?: string[];
  };
}

type StoreOption = 'sqlite' | 'firestore';
type EmbedOption = 'ollama' | 'vertex' | 'openai';
type LlmOption = 'ollama' | 'gemini' | 'anthropic' | 'openai';

interface InitOptions {
  name: string;
  store: StoreOption;
  embed: EmbedOption;
  llm: LlmOption;
  namespace: string;
  here: boolean;
  obsidian: boolean;
}

// ─── Arg Parsing ───────────────────────────────────────────────────────────

export function parseInitArgs(args: string[]): InitOptions | null {
  const opts: InitOptions = {
    name: '',
    store: 'sqlite',
    embed: 'ollama',
    llm: 'ollama',
    namespace: 'default',
    here: false,
    obsidian: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--here') {
      opts.here = true;
    } else if (arg === '--obsidian') {
      opts.obsidian = true;
    } else if (arg === '--store') {
      const val = args[++i];
      if (val !== 'sqlite' && val !== 'firestore') {
        console.error(`[cortex-kit] Invalid --store value: ${val}. Must be sqlite or firestore.`);
        return null;
      }
      opts.store = val;
    } else if (arg === '--embed') {
      const val = args[++i];
      if (val !== 'ollama' && val !== 'vertex' && val !== 'openai') {
        console.error(`[cortex-kit] Invalid --embed value: ${val}. Must be ollama, vertex, or openai.`);
        return null;
      }
      opts.embed = val;
    } else if (arg === '--llm') {
      const val = args[++i];
      if (val !== 'ollama' && val !== 'gemini' && val !== 'anthropic' && val !== 'openai') {
        console.error(`[cortex-kit] Invalid --llm value: ${val}. Must be ollama, gemini, anthropic, or openai.`);
        return null;
      }
      opts.llm = val;
    } else if (arg === '--namespace') {
      opts.namespace = args[++i] ?? 'default';
    } else if (!arg.startsWith('--')) {
      opts.name = arg;
    } else {
      console.error(`[cortex-kit] Unknown option: ${arg}`);
      return null;
    }

    i++;
  }

  if (!opts.here && !opts.name) {
    console.error('[cortex-kit] init requires a name argument or --here flag.');
    console.error('  Usage: cortex-kit init <name>');
    console.error('         cortex-kit init --here');
    return null;
  }

  // When --here, derive name from current directory
  if (opts.here && !opts.name) {
    opts.name = process.cwd().split(/[\\/]/).pop() ?? 'agent';
  }

  return opts;
}

// ─── Templates ─────────────────────────────────────────────────────────────

function buildAgentYaml(opts: InitOptions): string {
  return `# Fozikio Agent — Identity & Connection Manifest

agent:
  name: ${opts.name}
  version: "1.0"

identity:
  profile: mind/profile.md
  session_state: state/session-state.md

cortex:
  ${opts.namespace}:
    store: ${opts.store}
    embed: ${opts.embed}
    primary: true

credentials:
  dir: credentials/
  encryption: none
`;
}

function buildAgentKitJson(): string {
  return `{
  "version": "1.0",
  "hooks": [],
  "skills": [],
  "agents": []
}
`;
}

function buildFozikioReadme(name: string): string {
  return `# .fozikio/

This directory is the agent workspace manifest for **${name}**.

It is read by cortex-engine and cortex-kit to configure the agent's identity,
storage backend, embedding provider, and installed components.

## Files

| File | Purpose |
|------|---------|
| \`agent.yaml\` | Identity manifest — agent name, cortex config, credentials |
| \`agent-kit.json\` | Installable components — hooks, skills, agents |
| \`mind/profile.md\` | Agent identity profile (who this agent is) |
| \`knowledge/_index.md\` | Knowledge base index |
| \`journal/\` | Session journal entries |
| \`state/templates/\` | Note templates for structured memory |
| \`credentials/\` | Local credentials (gitignored) |

## Usage

Start the MCP server:
\`\`\`
npx cortex-engine
\`\`\`

Or configure via .mcp.json and let your MCP client manage the lifecycle.
`;
}

function buildMindProfile(name: string): string {
  return `---
type: mind
status: active
tags: []
---

# ${name}

## Identity

*Who is this agent? Fill in your identity here.*

## Values

-

## Working Style

-

## Goals

-

## Relationships

*Key people, systems, and projects this agent interacts with.*
`;
}

const KNOWLEDGE_INDEX = `---
type: knowledge
status: active
tags: []
---

# Knowledge Index

*Reference material, decisions, and patterns.*
`;


const MCP_JSON = `{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["cortex-engine"]
    }
  }
}
`;

const COGNITIVE_TOOLS_REFERENCE = `# Cognitive Tools

This workspace uses cortex-engine for persistent memory and cognition.

## Available Tools

| Tool | What it does |
|------|-------------|
| \`observe\` | Record an observation — cortex decides if it's novel, similar, or duplicate |
| \`query\` | Semantic search across memory with HyDE expansion |
| \`recall\` | Browse recent observations and memories by time |
| \`neighbors\` | Explore the memory graph from a specific concept |
| \`predict\` | Proactive retrieval — what's relevant given current context |
| \`validate\` | Check a prediction against an outcome (FSRS learning) |
| \`believe\` | Record a belief change with reason tracking |
| \`reflect\` | Generate reflective insights connecting observations |
| \`dream\` | Run consolidation — cluster, refine, create, connect, score, abstract |
| \`digest\` | Process a document through the ingestion pipeline |
| \`stats\` | Memory counts and namespace health |
| \`ops_append\` | Log operational breadcrumbs |
| \`ops_query\` | Query the operational log |
| \`ops_update\` | Update an ops entry |
| \`wander\` | Random graph walk for serendipitous discovery |

## Usage Pattern

Before working on any topic, query cortex first:
\`\`\`
query("the topic you're working on")
\`\`\`

When you learn something interesting:
\`\`\`
observe("what you noticed")
\`\`\`

At session end, run dream to consolidate:
\`\`\`
dream()
\`\`\`

## Installed Hooks

Cortex-kit hooks are installed in \`.claude/hooks/\`. They fire automatically:

- **cognitive-grounding** — reminds you to \`query()\` before evaluation/design/review work
- **observe-first** — warns before writing to memory directories without \`observe()\`/\`query()\`
- **cortex-telemetry** — tracks retrieval patterns for quality feedback
- **session-lifecycle** — resets session state on startup
- **project-board-gate** — gates \`git push\` on board updates (configure via \`.claude/state/project-boards.json\`)

To disable any hook, delete its \`.sh\` file from \`.claude/hooks/\`.

## Installed Skills

- **/cortex-query** — best practices for querying cortex memory
- **/cortex-review** — structured review workflow grounded in cortex context
`;

const OBSIDIAN_APP_JSON = `{
  "legacyEditor": false,
  "livePreview": true,
  "defaultViewMode": "source",
  "vimMode": false
}
`;

const OBSIDIAN_APPEARANCE_JSON = `{
  "theme": "obsidian"
}
`;

// ─── Manifest & Asset Installation ────────────────────────────────────────

/** Resolve the package root (where cortex-kit.json lives). */
function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/bin/init.js → package root (two levels up)
  return resolve(dirname(thisFile), '..', '..');
}

function loadManifest(packageRoot: string): KitManifest | null {
  const manifestPath = join(packageRoot, 'cortex-kit.json');
  if (!existsSync(manifestPath)) {
    console.error('[cortex-kit] Warning: cortex-kit.json not found — skipping hook/skill installation.');
    return null;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as KitManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cortex-kit] Warning: Failed to parse cortex-kit.json: ${msg} — skipping hook/skill installation.`);
    return null;
  }
}

function installHooks(packageRoot: string, targetDir: string, hooks: string[]): string[] {
  const sourceDir = join(packageRoot, 'hooks');
  const destDir = join(targetDir, '.claude', 'hooks');
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    console.error('[cortex-kit] Warning: hooks/ directory not found in package — skipping hook installation.');
    return installed;
  }

  mkdirSync(destDir, { recursive: true });

  for (const hook of hooks) {
    const hookFile = `${hook}.sh`;
    const src = join(sourceDir, hookFile);
    if (!existsSync(src)) {
      console.error(`[cortex-kit] Warning: hook not found: ${hookFile} — skipping.`);
      continue;
    }
    const dest = join(destDir, hookFile);
    cpSync(src, dest);
    // Set execute bit on Unix (no-op failure on Windows is fine)
    try { chmodSync(dest, 0o755); } catch { /* Windows — no execute bit */ }
    installed.push(hookFile);
  }

  return installed;
}

function installSkills(packageRoot: string, targetDir: string, skills: string[]): string[] {
  const sourceDir = join(packageRoot, 'skills');
  const destDir = join(targetDir, '.claude', 'skills');
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    console.error('[cortex-kit] Warning: skills/ directory not found in package — skipping skill installation.');
    return installed;
  }

  mkdirSync(destDir, { recursive: true });

  for (const skill of skills) {
    const src = join(sourceDir, skill);
    if (!existsSync(src)) {
      console.error(`[cortex-kit] Warning: skill not found: ${skill}/ — skipping.`);
      continue;
    }
    const dest = join(destDir, skill);
    mkdirSync(dest, { recursive: true });
    // Copy all files in the skill directory
    for (const file of readdirSync(src)) {
      cpSync(join(src, file), join(dest, file));
    }
    installed.push(skill);
  }

  return installed;
}

// ─── Scaffold ──────────────────────────────────────────────────────────────

export function runInit(args: string[]): void {
  const opts = parseInitArgs(args);
  if (!opts) {
    process.exit(1);
  }

  const targetDir = opts.here
    ? process.cwd()
    : resolve(process.cwd(), opts.name);

  if (!opts.here && existsSync(targetDir)) {
    console.error(`[cortex-kit] Directory already exists: ${targetDir}`);
    console.error('  Use --here to scaffold into the current directory.');
    process.exit(1);
  }

  // Create target directory
  mkdirSync(targetDir, { recursive: true });

  // .fozikio/ — agent manifest directory
  const fozikioDir = join(targetDir, '.fozikio');
  mkdirSync(fozikioDir, { recursive: true });

  // .fozikio/agent.yaml
  writeFileSync(join(fozikioDir, 'agent.yaml'), buildAgentYaml(opts), 'utf-8');

  // .fozikio/agent-kit.json
  writeFileSync(join(fozikioDir, 'agent-kit.json'), buildAgentKitJson(), 'utf-8');

  // .fozikio/README.md
  writeFileSync(join(fozikioDir, 'README.md'), buildFozikioReadme(opts.name), 'utf-8');

  // .fozikio/mind/profile.md
  const mindDir = join(fozikioDir, 'mind');
  mkdirSync(mindDir, { recursive: true });
  writeFileSync(join(mindDir, 'profile.md'), buildMindProfile(opts.name), 'utf-8');

  // .fozikio/knowledge/_index.md
  const knowledgeDir = join(fozikioDir, 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, '_index.md'), KNOWLEDGE_INDEX, 'utf-8');

  // .fozikio/journal/ (empty dir — needs a placeholder so it exists in git)
  const journalDir = join(fozikioDir, 'journal');
  mkdirSync(journalDir, { recursive: true });

  // .fozikio/state/templates/ (empty dir)
  const stateTemplatesDir = join(fozikioDir, 'state', 'templates');
  mkdirSync(stateTemplatesDir, { recursive: true });

  // .fozikio/credentials/.gitignore
  const credentialsDir = join(fozikioDir, 'credentials');
  mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(join(credentialsDir, '.gitignore'), '*\n!.gitignore\n', 'utf-8');

  // .mcp.json
  writeFileSync(join(targetDir, '.mcp.json'), MCP_JSON, 'utf-8');

  // CLAUDE.md
  writeFileSync(join(targetDir, 'CLAUDE.md'), COGNITIVE_TOOLS_REFERENCE, 'utf-8');

  // AGENTS.md
  writeFileSync(join(targetDir, 'AGENTS.md'), COGNITIVE_TOOLS_REFERENCE, 'utf-8');

  // .obsidian/
  if (opts.obsidian) {
    const obsidianDir = join(targetDir, '.obsidian');
    mkdirSync(obsidianDir, { recursive: true });
    writeFileSync(join(obsidianDir, 'app.json'), OBSIDIAN_APP_JSON, 'utf-8');
    writeFileSync(join(obsidianDir, 'appearance.json'), OBSIDIAN_APPEARANCE_JSON, 'utf-8');
  }

  // Install hooks and skills from manifest
  const packageRoot = getPackageRoot();
  const manifest = loadManifest(packageRoot);
  const installedHooks: string[] = [];
  const installedSkills: string[] = [];
  let hasHookifyRules = false;

  if (manifest?.contents) {
    if (manifest.contents.hooks && manifest.contents.hooks.length > 0) {
      installedHooks.push(...installHooks(packageRoot, targetDir, manifest.contents.hooks));
    }
    if (manifest.contents.skills && manifest.contents.skills.length > 0) {
      installedSkills.push(...installSkills(packageRoot, targetDir, manifest.contents.skills));
    }
    hasHookifyRules = (manifest.contents.hookify_rules ?? []).length > 0;
  }

  // Success message
  const relativePath = opts.here ? '.' : opts.name;
  console.error(`[cortex-kit] Workspace scaffolded at: ${targetDir}`);
  console.error('');
  console.error('Files created:');
  console.error(`  ${relativePath}/.fozikio/agent.yaml`);
  console.error(`  ${relativePath}/.fozikio/agent-kit.json`);
  console.error(`  ${relativePath}/.fozikio/README.md`);
  console.error(`  ${relativePath}/.fozikio/mind/profile.md`);
  console.error(`  ${relativePath}/.fozikio/knowledge/_index.md`);
  console.error(`  ${relativePath}/.fozikio/journal/`);
  console.error(`  ${relativePath}/.fozikio/state/templates/`);
  console.error(`  ${relativePath}/.fozikio/credentials/.gitignore`);
  console.error(`  ${relativePath}/.mcp.json`);
  console.error(`  ${relativePath}/CLAUDE.md`);
  console.error(`  ${relativePath}/AGENTS.md`);
  if (opts.obsidian) {
    console.error(`  ${relativePath}/.obsidian/app.json`);
    console.error(`  ${relativePath}/.obsidian/appearance.json`);
  }
  if (installedHooks.length > 0) {
    console.error('');
    console.error('Hooks installed:');
    for (const hook of installedHooks) {
      console.error(`  ${relativePath}/.claude/hooks/${hook}`);
    }
  }
  if (installedSkills.length > 0) {
    console.error('');
    console.error('Skills installed:');
    for (const skill of installedSkills) {
      console.error(`  ${relativePath}/.claude/skills/${skill}/`);
    }
  }
  if (hasHookifyRules) {
    console.error('');
    console.error('Recommended hookify rules available. Run `cortex-kit install-rules` to install.');
  }
  console.error('');
  console.error('Next steps:');
  if (!opts.here) {
    console.error(`  cd ${opts.name}`);
  }
  console.error(`  # Edit .fozikio/agent.yaml to configure your store and providers`);
  console.error(`  # Add cortex to your MCP client using .mcp.json`);
  console.error(`  npx cortex-engine   # start the MCP server`);
}
