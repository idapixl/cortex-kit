/**
 * init.ts — fozikio init command.
 *
 * Scaffolds a new agent workspace with cortex-engine configuration.
 *
 * Usage:
 *   fozikio init <name> [options]
 *   fozikio init --here [options]
 *
 * Options:
 *   --store sqlite|firestore   Storage backend (default: sqlite)
 *   --embed built-in|ollama|vertex|openai   Embedding provider (default: built-in)
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
    reflex_rules?: string[];
    hookify_rules?: string[];  // legacy compat
    skills?: string[];
    agents?: string[];
  };
}

type StoreOption = 'sqlite' | 'firestore';
type EmbedOption = 'built-in' | 'ollama' | 'vertex' | 'openai';
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
    embed: 'built-in',
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
        console.error(`[fozikio] Invalid --store value: ${val}. Must be sqlite or firestore.`);
        return null;
      }
      opts.store = val;
    } else if (arg === '--embed') {
      const val = args[++i];
      if (val !== 'built-in' && val !== 'ollama' && val !== 'vertex' && val !== 'openai') {
        console.error(`[fozikio] Invalid --embed value: ${val}. Must be built-in, ollama, vertex, or openai.`);
        return null;
      }
      opts.embed = val;
    } else if (arg === '--llm') {
      const val = args[++i];
      if (val !== 'ollama' && val !== 'gemini' && val !== 'anthropic' && val !== 'openai') {
        console.error(`[fozikio] Invalid --llm value: ${val}. Must be ollama, gemini, anthropic, or openai.`);
        return null;
      }
      opts.llm = val;
    } else if (arg === '--namespace') {
      opts.namespace = args[++i] ?? 'default';
    } else if (!arg.startsWith('--')) {
      opts.name = arg;
    } else {
      console.error(`[fozikio] Unknown option: ${arg}`);
      return null;
    }

    i++;
  }

  if (!opts.here && !opts.name) {
    console.error('[fozikio] init requires a name argument or --here flag.');
    console.error('  Usage: fozikio init <name>');
    console.error('         fozikio init --here');
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

agents: {}

# Each named entry is an isolated memory namespace with its own store.
# This default gives you two: project knowledge and personal context.
# Rename, remove, or add more — the architecture is modular:
#   one namespace, five, shared across agents, scoped per-agent — your call.
cortex:
  project:
    store: ${opts.store}
    embed: ${opts.embed}
    primary: true
  personal:
    store: ${opts.store}
    embed: ${opts.embed}

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
  return `# ${name}

No memories yet. That changes once you run \`fozikio serve\`
and your agent starts using the tools.

## tools at a glance

observe — store a fact worth remembering
query — find memories by meaning
believe — record a position that could change
predict — anticipate based on what's known
dream — consolidate and compress over time

Memories that matter get stronger. Memories that don't, fade.

See TOOLS.md for the full reference.
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


function buildMcpJson(): string {
  // Read version from package.json for pinning
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  let version = '0.6.0';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    version = pkg.version ?? version;
  } catch { /* use fallback */ }

  if (process.platform === 'win32') {
    return JSON.stringify({
      mcpServers: {
        cortex: {
          command: 'cmd',
          args: ['/c', 'npx', '-y', `cortex-engine@${version}`],
        },
      },
    }, null, 2) + '\n';
  }
  return JSON.stringify({
    mcpServers: {
      cortex: {
        command: 'npx',
        args: ['-y', `cortex-engine@${version}`],
      },
    },
  }, null, 2) + '\n';
}

// ─── TOOLS.md — Agent-Agnostic Tool Reference ────────────────────────────
// This is the canonical reference. Lives at .fozikio/TOOLS.md.
// Any agent on any platform reads this file.

const TOOLS_REFERENCE = `# Cortex Tools

This workspace uses cortex-engine for persistent memory. These tools are available via MCP — any compatible client can use them.

## Use the Right Tool

Don't dump everything into \`observe()\`. Match the tool to what you're recording:

| What you're recording | Use this | Not this |
|----------------------|----------|----------|
| A fact you learned or confirmed | \`observe\` | — |
| An open question or curiosity | \`wonder\` | observe() |
| A hypothesis or untested idea | \`speculate\` | observe() |
| A position that could change with new evidence | \`believe\` | observe() |
| Something worth deeper processing | \`reflect\` | observe() |
| Ongoing work or open questions across sessions | \`thread_create\` / \`thread_update\` | observe() |
| Session reflection at end of day | \`journal_write\` | observe() |
| Operational breadcrumbs during work | \`ops_append\` | observe() |
| An identity or behavior change | \`evolve\` | observe() |

## Core Tools (25)

**Write — record knowledge:**
| Tool | Purpose |
|------|---------|
| \`observe\` | Record a fact — something you learned, confirmed, or noticed to be true |
| \`wonder\` | Record an open question or curiosity — stored separately from facts |
| \`speculate\` | Record a hypothesis or untested idea — excluded from default retrieval |
| \`believe\` | Update what you believe about an existing memory |
| \`reflect\` | Synthesize what you know about a topic into a grounded reflection |
| \`digest\` | Ingest a document — extracts facts and generates reflections |

**Read — retrieve knowledge:**
| Tool | Purpose |
|------|---------|
| \`query\` | Search memories by meaning |
| \`recall\` | List recent observations chronologically |
| \`predict\` | Anticipate what memories might be relevant next |
| \`validate\` | Confirm or deny a prediction — strengthens or weakens the memory |
| \`neighbors\` | Explore memories connected to a specific concept |
| \`wander\` | Random walk for serendipitous discovery |

**Threads — ongoing work:**
| Tool | Purpose |
|------|---------|
| \`thread_create\` | Start tracking an ongoing question, project, or exploration |
| \`thread_update\` | Add progress, change status, link related memories |
| \`thread_resolve\` | Close a thread with a resolution |
| \`threads_list\` | See open threads (check at session start) |

**Ops — session tracking:**
| Tool | Purpose |
|------|---------|
| \`ops_append\` | Log a session breadcrumb, milestone, or decision |
| \`ops_query\` | Search the operational log |
| \`ops_update\` | Update an ops entry status or content |

**Identity:**
| Tool | Purpose |
|------|---------|
| \`evolve\` | Propose a change to values, preferences, or patterns |
| \`evolution_list\` | View pending or applied identity proposals |
| \`journal_write\` | Write a daily reflective entry |
| \`journal_read\` | Read past journal entries |

**System:**
| Tool | Purpose |
|------|---------|
| \`stats\` | Memory counts and namespace health |
| \`dream\` | Consolidate observations into long-term memories (run periodically) |

## Hard Rules

1. **Read before you write** — call \`query()\` before adding to cortex. Check what you already know.
2. **Use the full tool suite** — if you're only using observe/query, you're missing the point. Threads, journals, beliefs, and reflections exist for a reason.
3. **Check threads at session start** — call \`threads_list()\` to see what's in progress before starting new work.
`;

// ─── CLAUDE.md — Claude Code Platform Pointer ────────────────────────────
// Thin pointer to TOOLS.md + Claude-specific context (hooks, skills).

const CLAUDE_MD = `# Cognitive Tools

This workspace uses [cortex-engine](https://github.com/Fozikio/cortex-engine) for persistent memory.

**Read \`.fozikio/TOOLS.md\` for the full tool reference** — all 25+ cognitive tools with usage guidance.

## Memory

You have persistent memory via cortex. Use it naturally:

- Before starting work → \`query()\` what you know about the topic
- After learning something → \`observe("...", namespace: "<relevant-namespace>")\`
- For ongoing work → \`thread_create()\` / \`thread_update()\`
- Before observing → ask: would my future self search for this? If not, skip it.

Your namespaces are defined in \`.fozikio/agent.yaml\`. Each is an isolated memory space — add more, merge them, or restructure as needs evolve. Check agent.yaml for what's configured.

Don't announce when you're remembering. Don't ask permission. Just be the kind of assistant who doesn't forget.

## Quick Reference

- Before substantive work → \`query()\` to ground in accumulated knowledge
- Facts → \`observe()\` | Questions → \`wonder()\` | Positions → \`believe()\`
- Ongoing work → \`thread_create()\` / \`thread_update()\`
- Session end → \`journal_write()\` | Operational logs → \`ops_append()\`
- Namespace config → \`.fozikio/agent.yaml\` (add/remove/rename freely)

## Installed Hooks

Hooks in \`.claude/hooks/\` fire automatically on Claude Code events. Read the comment headers in each \`.sh\` file for details.

## Installed Skills

Skills in \`.claude/skills/\` are invocable workflows. Use \`/skill-name\` to run them.

## Safety Rules

Reflex rules in \`reflex-rules/\` enforce cognitive habits. See [@fozikio/reflex](https://github.com/Fozikio/reflex) for format details.
`;

// ─── AGENTS.md — Multi-Agent Roster ──────────────────────────────────────
// NOT a tool reference. Lists who's in the workspace and what they do.

function buildAgentsRoster(name: string): string {
  return [
    '# Agents',
    '',
    `## ${name}`,
    '',
    'This workspace has a single agent. The agent\'s identity is defined in `.fozikio/mind/profile.md`.',
    '',
    '### Cognitive Tools',
    '',
    'See `.fozikio/TOOLS.md` for the full tool reference.',
    '',
    '### Architecture',
    '',
    'Fozikio is modular — agents, namespaces, and stores are independently configurable:',
    '',
    '- **1 agent, 1 namespace** — minimal setup',
    '- **1 agent, N namespaces** — isolated memory scopes (this default)',
    '- **N agents, shared namespaces** — collaborative memory',
    '- **N agents, separate namespaces** — fully isolated',
    '',
    'Edit `.fozikio/agent.yaml` to reconfigure. See [architecture docs](https://github.com/Fozikio/cortex-engine/wiki) for patterns.',
    '',
  ].join('\n');
}

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

// ─── Plugin Detection ─────────────────────────────────────────────────────

/** Plugin metadata for TOOLS.md generation */
const KNOWN_PLUGINS: Record<string, { description: string; tools: string }> = {
  '@fozikio/tools-content': {
    description: 'Content pipeline — draft, review, publish workflow',
    tools: '`content_create`, `content_list`, `content_update`',
  },
  '@fozikio/tools-social': {
    description: 'Social cognition — interaction patterns, engagement tracking',
    tools: '`social_read`, `social_update`',
  },
  '@fozikio/tools-graph': {
    description: 'Graph analysis — memory connections, clustering, visualization',
    tools: '`graph_report`, `suggest_links`, `find_duplicates`',
  },
  '@fozikio/tools-maintenance': {
    description: 'Memory maintenance — cleanup, deduplication, health checks',
    tools: '`consolidation_status`, `sleep_pressure`',
  },
  '@fozikio/tools-vitals': {
    description: 'Vitals tracking — agent health metrics and operational signals',
    tools: '`vitals_get`, `vitals_set`',
  },
  '@fozikio/tools-reasoning': {
    description: 'Cognitive reasoning — abstraction, contradiction, surfacing',
    tools: '`abstract`, `contradict`, `surface`, `notice`, `resolve`, `intention`, `predict`',
  },
};

/**
 * Scan for installed @fozikio/tools-* plugin packages and return
 * a markdown section listing their tools for TOOLS.md.
 */
function detectInstalledPlugins(targetDir: string): string | null {
  const found: { name: string; description: string; tools: string }[] = [];

  for (const [pkg, meta] of Object.entries(KNOWN_PLUGINS)) {
    try {
      const pkgJsonPath = join(targetDir, 'node_modules', ...pkg.split('/'), 'package.json');
      if (existsSync(pkgJsonPath)) {
        found.push({ name: pkg, ...meta });
      }
    } catch {
      // skip
    }
  }

  if (found.length === 0) return null;

  let section = '\n## Installed Plugins\n\n';
  for (const plugin of found) {
    section += `**${plugin.name}** — ${plugin.description}\n`;
    section += `Tools: ${plugin.tools}\n\n`;
  }
  section += `*Plugins are auto-detected from node_modules. Install more with \`npm install @fozikio/tools-<name>\`.*\n`;
  return section;
}

// ─── Manifest & Asset Installation ────────────────────────────────────────

/** Resolve the package root (where fozikio.json lives). */
function getPackageRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/bin/init.js → package root (two levels up)
  return resolve(dirname(thisFile), '..', '..');
}

function loadManifest(packageRoot: string): KitManifest | null {
  const manifestPath = join(packageRoot, 'fozikio.json');
  if (!existsSync(manifestPath)) {
    console.error('[fozikio] Warning: fozikio.json not found — skipping hook/skill installation.');
    return null;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as KitManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fozikio] Warning: Failed to parse fozikio.json: ${msg} — skipping hook/skill installation.`);
    return null;
  }
}

function installHooks(packageRoot: string, targetDir: string, hooks: string[]): string[] {
  const sourceDir = join(packageRoot, 'hooks');
  const destDir = join(targetDir, '.claude', 'hooks');
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    console.error('[fozikio] Warning: hooks/ directory not found in package — skipping hook installation.');
    return installed;
  }

  mkdirSync(destDir, { recursive: true });

  for (const hook of hooks) {
    const hookFile = `${hook}.sh`;
    const src = join(sourceDir, hookFile);
    if (!existsSync(src)) {
      console.error(`[fozikio] Warning: hook not found: ${hookFile} — skipping.`);
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

function installReflexRules(packageRoot: string, targetDir: string, rules: string[]): string[] {
  const sourceDir = join(packageRoot, 'reflex-rules');
  const destDir = join(targetDir, 'reflex-rules');
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    console.error('[fozikio] Warning: reflex-rules/ directory not found in package — skipping rule installation.');
    return installed;
  }

  mkdirSync(destDir, { recursive: true });

  for (const rule of rules) {
    const ruleFile = `${rule}.yaml`;
    const src = join(sourceDir, ruleFile);
    if (!existsSync(src)) {
      console.error(`[fozikio] Warning: reflex rule not found: ${ruleFile} — skipping.`);
      continue;
    }
    const dest = join(destDir, ruleFile);
    cpSync(src, dest);
    installed.push(ruleFile);
  }

  return installed;
}

function installSkills(packageRoot: string, targetDir: string, skills: string[]): string[] {
  const sourceDir = join(packageRoot, 'skills');
  const destDir = join(targetDir, '.claude', 'skills');
  const installed: string[] = [];

  if (!existsSync(sourceDir)) {
    console.error('[fozikio] Warning: skills/ directory not found in package — skipping skill installation.');
    return installed;
  }

  mkdirSync(destDir, { recursive: true });

  for (const skill of skills) {
    const src = join(sourceDir, skill);
    if (!existsSync(src)) {
      console.error(`[fozikio] Warning: skill not found: ${skill}/ — skipping.`);
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
    console.error(`[fozikio] Directory already exists: ${targetDir}`);
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

  // .mcp.json — platform-aware, version-pinned
  writeFileSync(join(targetDir, '.mcp.json'), buildMcpJson(), 'utf-8');

  // .fozikio/TOOLS.md — canonical agent-agnostic tool reference
  let toolsContent = TOOLS_REFERENCE;
  // Detect installed plugins and append their tool sections
  const pluginSections = detectInstalledPlugins(targetDir);
  if (pluginSections) {
    toolsContent += pluginSections;
  }
  writeFileSync(join(fozikioDir, 'TOOLS.md'), toolsContent, 'utf-8');

  // CLAUDE.md — thin pointer for Claude Code users
  writeFileSync(join(targetDir, 'CLAUDE.md'), CLAUDE_MD, 'utf-8');

  // AGENTS.md — multi-agent roster
  writeFileSync(join(targetDir, 'AGENTS.md'), buildAgentsRoster(opts.name), 'utf-8');

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
  const installedRules: string[] = [];

  if (manifest?.contents) {
    if (manifest.contents.hooks && manifest.contents.hooks.length > 0) {
      installedHooks.push(...installHooks(packageRoot, targetDir, manifest.contents.hooks));
    }
    if (manifest.contents.skills && manifest.contents.skills.length > 0) {
      installedSkills.push(...installSkills(packageRoot, targetDir, manifest.contents.skills));
    }
    const reflexRuleNames = manifest.contents.reflex_rules ?? manifest.contents.hookify_rules ?? [];
    if (reflexRuleNames.length > 0) {
      installedRules.push(...installReflexRules(packageRoot, targetDir, reflexRuleNames));
    }
  }

  // Success output
  const relativePath = opts.here ? '.' : opts.name;
  const embedNote = opts.embed === 'built-in' ? ' (23MB, downloads on first use)' : '';
  const toolCount = 25 + (pluginSections ? pluginSections.split('| `').length - 1 : 0);

  const log = (s: string) => console.error(s);
  log('');
  log(`  \u25C7 store \u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7 ${opts.store}`);
  log(`  \u25C7 embeddings \u00B7\u00B7\u00B7 ${opts.embed}${embedNote}`);
  log(`  \u25C7 namespaces \u00B7\u00B7\u00B7 2 configured (edit agent.yaml to add more)`);
  log(`  \u25C7 tools \u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7 ${toolCount} registered`);
  if (installedHooks.length > 0) {
    log(`  \u25C7 hooks \u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7 ${installedHooks.length} installed`);
  }
  if (installedRules.length > 0) {
    log(`  \u25C7 safety \u00B7\u00B7\u00B7\u00B7\u00B7\u00B7 reflex rules applied`);
  }
  log('');
  log(`  ${opts.name} initialized at ./${relativePath}/`);
  log('');
  if (!opts.here) {
    log(`  next: cd ${opts.name} && npx fozikio serve`);
  } else {
    log('  next: npx fozikio serve');
  }
  log('');
}
