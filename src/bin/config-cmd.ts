/**
 * config-cmd.ts — cortex-kit config command handler.
 *
 * Usage:
 *   cortex-kit config                     Show current config
 *   cortex-kit config --store sqlite      Set storage backend
 *   cortex-kit config --embed ollama      Set embedding provider
 *   cortex-kit config --llm ollama        Set LLM provider
 *   cortex-kit config --path              Show config file path
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadConfig } from './config-loader.js';
import { DEFAULT_CONFIG } from '../core/config.js';
import type { CortexConfig, AgentConfig } from '../core/config.js';

// ─── Config File Discovery ────────────────────────────────────────────────────

/**
 * Find the config file path — mirrors the search order in config-loader.ts.
 * Checks agent.yaml (new format) before config.yaml (legacy format).
 * Returns null if no config file exists (defaults are in use).
 */
function findConfigPath(cwd: string = process.cwd()): string | null {
  const searchPaths = [
    resolve(cwd, '.fozikio', 'agent.yaml'),
    resolve(cwd, '.fozikio', 'config.yaml'),
    resolve(cwd, 'cortex.config.yaml'),
    resolve(cwd, 'config.yaml'),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

/**
 * Default write location when no config exists yet.
 * Uses agent.yaml (new format).
 */
function defaultConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '.fozikio', 'agent.yaml');
}

// ─── Config Read/Write ────────────────────────────────────────────────────────

/**
 * Read the raw config file and return the parsed object (AgentConfig or CortexConfig)
 * plus the config path and whether the file was wrapped in an agent config.
 */
interface RawConfigResult {
  path: string;
  wrapped: boolean;
  agentMeta: AgentConfig['agent'] | undefined;
  cortexConfig: Partial<CortexConfig>;
}

function readRawConfig(configPath: string): RawConfigResult {
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as AgentConfig | CortexConfig | null;

  if (!parsed || typeof parsed !== 'object') {
    return {
      path: configPath,
      wrapped: false,
      agentMeta: undefined,
      cortexConfig: {},
    };
  }

  if ('cortex' in parsed && parsed.cortex) {
    const agentParsed = parsed as AgentConfig;
    return {
      path: configPath,
      wrapped: true,
      agentMeta: agentParsed.agent,
      cortexConfig: agentParsed.cortex as Partial<CortexConfig>,
    };
  }

  return {
    path: configPath,
    wrapped: false,
    agentMeta: undefined,
    cortexConfig: parsed as Partial<CortexConfig>,
  };
}

/**
 * Write config back to the file, preserving agent wrapper if present.
 */
function writeConfig(raw: RawConfigResult, updates: Partial<CortexConfig>): void {
  const merged: Partial<CortexConfig> = { ...raw.cortexConfig, ...updates };

  let outObject: AgentConfig | Partial<CortexConfig>;

  if (raw.wrapped) {
    outObject = {
      ...(raw.agentMeta !== undefined ? { agent: raw.agentMeta } : {}),
      cortex: merged as CortexConfig,
    } as AgentConfig;
  } else {
    outObject = merged;
  }

  const yaml = stringifyYaml(outObject);
  const dir = dirname(raw.path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(raw.path, yaml, 'utf-8');
}

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

interface ParsedConfigArgs {
  showPath: boolean;
  store: CortexConfig['store'] | null;
  embed: CortexConfig['embed'] | null;
  llm: CortexConfig['llm'] | null;
}

const VALID_STORES: ReadonlyArray<CortexConfig['store']> = ['sqlite', 'firestore'];
const VALID_EMBEDS: ReadonlyArray<CortexConfig['embed']> = ['ollama', 'vertex', 'openai'];
const VALID_LLMS: ReadonlyArray<CortexConfig['llm']> = ['ollama', 'gemini', 'anthropic', 'openai'];

function parseArgs(args: string[]): ParsedConfigArgs {
  let showPath = false;
  let store: CortexConfig['store'] | null = null;
  let embed: CortexConfig['embed'] | null = null;
  let llm: CortexConfig['llm'] | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--path') {
      showPath = true;
    } else if (arg === '--store' && args[i + 1]) {
      const val = args[++i];
      if (!VALID_STORES.includes(val as CortexConfig['store'])) {
        process.stderr.write(`Error: invalid store "${val}". Valid values: ${VALID_STORES.join(', ')}\n`);
        process.exit(1);
      }
      store = val as CortexConfig['store'];
    } else if (arg === '--embed' && args[i + 1]) {
      const val = args[++i];
      if (!VALID_EMBEDS.includes(val as CortexConfig['embed'])) {
        process.stderr.write(`Error: invalid embed provider "${val}". Valid values: ${VALID_EMBEDS.join(', ')}\n`);
        process.exit(1);
      }
      embed = val as CortexConfig['embed'];
    } else if (arg === '--llm' && args[i + 1]) {
      const val = args[++i];
      if (!VALID_LLMS.includes(val as CortexConfig['llm'])) {
        process.stderr.write(`Error: invalid LLM provider "${val}". Valid values: ${VALID_LLMS.join(', ')}\n`);
        process.exit(1);
      }
      llm = val as CortexConfig['llm'];
    }
  }

  return { showPath, store, embed, llm };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function runConfig(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const hasUpdates = parsed.store !== null || parsed.embed !== null || parsed.llm !== null;

  // --path: just print the config file path.
  if (parsed.showPath) {
    const configPath = findConfigPath();
    if (configPath) {
      process.stdout.write(configPath + '\n');
    } else {
      process.stderr.write('No config file found. Default path would be:\n');
      process.stdout.write(defaultConfigPath() + '\n');
    }
    return;
  }

  // Setting flags: update config.
  if (hasUpdates) {
    const configPath = findConfigPath();
    const targetPath = configPath ?? defaultConfigPath();

    let raw: RawConfigResult;

    if (configPath) {
      raw = readRawConfig(configPath);
    } else {
      // No config file yet — start from defaults, write to default path.
      raw = {
        path: targetPath,
        wrapped: false,
        agentMeta: undefined,
        cortexConfig: { ...DEFAULT_CONFIG },
      };
    }

    const updates: Partial<CortexConfig> = {};
    if (parsed.store !== null) updates.store = parsed.store;
    if (parsed.embed !== null) updates.embed = parsed.embed;
    if (parsed.llm !== null) updates.llm = parsed.llm;

    writeConfig(raw, updates);

    process.stderr.write(`Config updated: ${targetPath}\n`);

    const parts: string[] = [];
    if (parsed.store !== null) parts.push(`store=${parsed.store}`);
    if (parsed.embed !== null) parts.push(`embed=${parsed.embed}`);
    if (parsed.llm !== null) parts.push(`llm=${parsed.llm}`);
    process.stderr.write(`  ${parts.join(', ')}\n`);
    return;
  }

  // Default: show current config as YAML.
  const config = loadConfig();
  process.stdout.write(stringifyYaml(config));
}
