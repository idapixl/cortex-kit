/**
 * agent-cmd.ts — fozikio agent subcommand tree.
 *
 * Usage:
 *   fozikio agent add <name> [options]   Register a new agent
 *   fozikio agent list                   List registered agents
 *   fozikio agent generate-mcp           Write multi-agent .mcp.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { findConfigPath } from './config-utils.js';
import type { AgentEntry } from '../core/config.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/;
const RESERVED_NAMES = new Set(['default', '__proto__', 'constructor', 'prototype']);

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentYaml {
  agent?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
  agents?: Record<string, AgentEntry>;
  cortex?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateAgentName(name: string): string | null {
  if (!NAME_PATTERN.test(name)) {
    return `Invalid agent name "${name}". Must match: ${NAME_PATTERN.source}`;
  }
  if (RESERVED_NAMES.has(name)) {
    return `"${name}" is a reserved name and cannot be used as an agent name.`;
  }
  return null;
}

// ─── YAML Read/Write ────────────────────────────────────────────────────────

function readAgentYaml(configPath: string): AgentYaml {
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as AgentYaml | null;
  return parsed ?? {};
}

function writeAgentYaml(configPath: string, doc: AgentYaml): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, stringifyYaml(doc), 'utf-8');
}

// ─── Subcommands ────────────────────────────────────────────────────────────

/**
 * `fozikio agent add <name>` — register a new agent.
 *
 * Options:
 *   --store sqlite|firestore   Storage backend (default: sqlite)
 *   --embed ollama|vertex|openai   Embedding provider (default: ollama)
 *   --description "..."   Agent description
 */
async function runAgentAdd(name: string, args: string[]): Promise<void> {
  // Validate name
  const nameError = validateAgentName(name);
  if (nameError) {
    console.error(`[fozikio] ${nameError}`);
    process.exit(1);
  }

  // Parse options
  let store = 'sqlite';
  let embed = 'ollama';
  let description = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--store' && args[i + 1]) {
      store = args[++i];
    } else if (arg === '--embed' && args[i + 1]) {
      embed = args[++i];
    } else if (arg === '--description' && args[i + 1]) {
      description = args[++i];
    }
  }

  // Find config
  const configPath = findConfigPath();
  if (!configPath) {
    console.error('[fozikio] No agent.yaml found. Run `fozikio init` first.');
    process.exit(1);
  }

  // Read existing YAML
  const doc = readAgentYaml(configPath);

  // Check for duplicate
  if (doc.agents && name in doc.agents) {
    console.error(`[fozikio] Agent "${name}" already exists.`);
    process.exit(1);
  }

  // Add agents entry
  if (!doc.agents) {
    doc.agents = {};
  }

  const namespace = name;
  const profilePath = `agents/${name}/profile.md`;

  const entry: AgentEntry = {
    namespace,
    profile: profilePath,
  };
  if (description) {
    entry.description = description;
  }

  doc.agents[name] = entry;

  // Add cortex entry with collections_prefix
  if (!doc.cortex) {
    doc.cortex = {};
  }

  const isPrimary = Object.keys(doc.cortex).length === 0;
  doc.cortex[namespace] = {
    store,
    embed,
    collections_prefix: `${namespace}_`,
    primary: isPrimary,
  };

  // Write YAML back
  writeAgentYaml(configPath, doc);

  // Create profile.md
  const configDir = dirname(configPath);
  const profileAbsolute = resolve(configDir, profilePath);
  const profileDir = dirname(profileAbsolute);

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  if (!existsSync(profileAbsolute)) {
    const profileContent = `---
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
`;
    writeFileSync(profileAbsolute, profileContent, 'utf-8');
    console.error(`[fozikio] Created profile: ${profilePath}`);
  }

  console.error(`[fozikio] Agent "${name}" added.`);
  console.error(`  namespace: ${namespace}`);
  console.error(`  profile: ${profilePath}`);
  console.error(`  collections_prefix: ${namespace}_`);
  console.error(`  store: ${store}, embed: ${embed}`);
}

/**
 * `fozikio agent list` — display all registered agents.
 */
async function runAgentList(): Promise<void> {
  const configPath = findConfigPath();
  if (!configPath) {
    console.error('[fozikio] No agent.yaml found. Run `fozikio init` first.');
    process.exit(1);
  }

  const doc = readAgentYaml(configPath);

  if (!doc.agents || Object.keys(doc.agents).length === 0) {
    console.error('[fozikio] No agents registered. Use `fozikio agent add <name>` to add one.');
    return;
  }

  const cortex = doc.cortex ?? {};

  console.error('[fozikio] Registered agents:\n');

  for (const [name, entry] of Object.entries(doc.agents)) {
    const ns = entry.namespace;
    const cortexEntry = cortex[ns] as Record<string, unknown> | undefined;
    const primary = cortexEntry?.primary === true ? ' (primary)' : '';
    const desc = entry.description ? ` — ${entry.description}` : '';

    console.error(`  ${name}${primary}${desc}`);
    console.error(`    namespace: ${ns}`);
    console.error(`    profile: ${entry.profile ?? '(none)'}`);

    if (cortexEntry) {
      const store = cortexEntry.store ?? '?';
      const embed = cortexEntry.embed ?? '?';
      const prefix = cortexEntry.collections_prefix ?? '';
      console.error(`    store: ${store}, embed: ${embed}, prefix: ${prefix}`);
    }

    console.error('');
  }
}

/**
 * `fozikio agent generate-mcp` — write a multi-agent .mcp.json.
 */
async function runGenerateMcp(): Promise<void> {
  const configPath = findConfigPath();
  if (!configPath) {
    console.error('[fozikio] No agent.yaml found. Run `fozikio init` first.');
    process.exit(1);
  }

  const doc = readAgentYaml(configPath);

  if (!doc.agents || Object.keys(doc.agents).length === 0) {
    console.error('[fozikio] No agents registered. Use `fozikio agent add <name>` first.');
    process.exit(1);
  }

  const mcpServers: Record<string, { command: string; args: string[] }> = {};

  for (const name of Object.keys(doc.agents)) {
    mcpServers[`cortex-${name}`] = {
      command: 'npx',
      args: ['fozikio', 'serve', '--agent', name],
    };
  }

  const mcpJson = JSON.stringify({ mcpServers }, null, 2) + '\n';

  // Write to the project root (parent of .fozikio/)
  const configDir = dirname(configPath);
  const projectRoot = dirname(configDir);
  const mcpPath = resolve(projectRoot, '.mcp.json');

  writeFileSync(mcpPath, mcpJson, 'utf-8');
  console.error(`[fozikio] Multi-agent .mcp.json written to: ${mcpPath}`);
  console.error(`  ${Object.keys(mcpServers).length} server(s): ${Object.keys(mcpServers).join(', ')}`);
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function runAgent(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'add': {
      const name = args[1];
      if (!name) {
        console.error('[fozikio] Usage: fozikio agent add <name>');
        process.exit(1);
      }
      await runAgentAdd(name, args.slice(2));
      break;
    }

    case 'list':
      await runAgentList();
      break;

    case 'generate-mcp':
      await runGenerateMcp();
      break;

    default:
      console.error(`[fozikio] agent: unknown subcommand "${subcommand ?? ''}"`);
      console.error('');
      console.error('Usage:');
      console.error('  fozikio agent add <name>      Register a new agent');
      console.error('  fozikio agent list             List registered agents');
      console.error('  fozikio agent generate-mcp     Write multi-agent .mcp.json');
      process.exit(1);
  }
}
