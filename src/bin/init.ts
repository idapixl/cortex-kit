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

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

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

function buildConfigYaml(opts: InitOptions): string {
  return `agent:
  name: ${opts.name}
  type: general

cortex:
  store: ${opts.store}
  embed: ${opts.embed}
  llm: ${opts.llm}

  namespaces:
    ${opts.namespace}:
      default: true
      description: "Default namespace"
      cognitive_tools:
        - observe
        - query
        - recall
        - neighbors
        - predict
        - reflect
        - dream
      collections_prefix: ""
`;
}

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

  // .fozikio/config.yaml
  const fozikioDir = join(targetDir, '.fozikio');
  mkdirSync(fozikioDir, { recursive: true });
  writeFileSync(join(fozikioDir, 'config.yaml'), buildConfigYaml(opts), 'utf-8');

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

  // Success message
  const relativePath = opts.here ? '.' : opts.name;
  console.error(`[cortex-kit] Workspace scaffolded at: ${targetDir}`);
  console.error('');
  console.error('Files created:');
  console.error(`  ${relativePath}/.fozikio/config.yaml`);
  console.error(`  ${relativePath}/.mcp.json`);
  console.error(`  ${relativePath}/CLAUDE.md`);
  console.error(`  ${relativePath}/AGENTS.md`);
  if (opts.obsidian) {
    console.error(`  ${relativePath}/.obsidian/app.json`);
    console.error(`  ${relativePath}/.obsidian/appearance.json`);
  }
  console.error('');
  console.error('Next steps:');
  if (!opts.here) {
    console.error(`  cd ${opts.name}`);
  }
  console.error(`  # Edit .fozikio/config.yaml to configure your store and providers`);
  console.error(`  # Add cortex to your MCP client using .mcp.json`);
  console.error(`  npx cortex-engine   # start the MCP server`);
}
