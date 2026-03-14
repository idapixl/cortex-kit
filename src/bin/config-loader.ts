/**
 * config-loader.ts — shared config loading for cortex-engine.
 *
 * Config search order:
 *   1. .fozikio/agent.yaml    (new workspace format)
 *   2. .fozikio/config.yaml   (legacy workspace format — backward compatible)
 *   3. cortex.config.yaml     (project root)
 *   4. config.yaml            (project root)
 *   5. defaults               (sqlite + ollama)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_CONFIG } from '../core/config.js';
import type { CortexConfig, AgentConfig, AgentEntry } from '../core/config.js';

/** Named cortex entry from agent.yaml (new format). */
interface NamedCortexEntry {
  store?: string;
  embed?: string;
  primary?: boolean;
}

/**
 * Detect whether the `cortex` block is the new named-map format (agent.yaml).
 *
 * New format: cortex values are objects with store/embed/primary.
 * Old format: cortex.store is a string.
 */
function isNamedCortexMap(cortex: unknown): cortex is Record<string, NamedCortexEntry> {
  if (!cortex || typeof cortex !== 'object') return false;
  const values = Object.values(cortex as Record<string, unknown>);
  // Named map: every value is an object (not a primitive)
  return values.length > 0 && values.every(v => v !== null && typeof v === 'object');
}

/**
 * Extract a CortexConfig from a named cortex map (agent.yaml new format).
 * Finds the entry marked `primary: true`, or falls back to the first entry.
 */
function extractFromNamedCortexMap(cortexMap: Record<string, NamedCortexEntry>): Partial<CortexConfig> {
  const entries = Object.entries(cortexMap);
  const primary = entries.find(([, v]) => v.primary === true) ?? entries[0];

  if (!primary) return {};

  const [, entry] = primary;
  const partial: Partial<CortexConfig> = {};

  if (entry.store === 'sqlite' || entry.store === 'firestore') {
    partial.store = entry.store;
  }
  if (entry.embed === 'ollama' || entry.embed === 'vertex' || entry.embed === 'openai') {
    partial.embed = entry.embed;
  }

  return partial;
}

/**
 * Resolve an agent's namespace from the agents block.
 * Returns the namespace string, or null if agent not found.
 */
function resolveAgentNamespace(
  parsed: AgentConfig,
  agentName: string,
): AgentEntry | null {
  const agents = parsed.agents;
  if (!agents || !(agentName in agents)) return null;
  return agents[agentName];
}

/**
 * Apply agent scoping to a CortexConfig: set the agent's namespace as default
 * and ensure collections_prefix is derived when missing.
 */
function applyAgentScope(config: CortexConfig, entry: AgentEntry): CortexConfig {
  const ns = entry.namespace;
  const scoped = { ...config };

  // Ensure the namespace exists
  scoped.namespaces = { ...scoped.namespaces };

  if (!scoped.namespaces[ns]) {
    // Create a minimal namespace entry
    scoped.namespaces[ns] = {
      default: true,
      description: entry.description ?? `Namespace for agent ${ns}`,
      cognitive_tools: ['observe', 'query', 'recall', 'neighbors', 'predict'],
      collections_prefix: `${ns}_`,
    };
  } else {
    // Ensure collections_prefix is set
    const nsConfig = { ...scoped.namespaces[ns] };
    if (!nsConfig.collections_prefix) {
      nsConfig.collections_prefix = `${ns}_`;
    }
    scoped.namespaces[ns] = nsConfig;
  }

  // Set this namespace as default, unset others
  for (const key of Object.keys(scoped.namespaces)) {
    scoped.namespaces[key] = {
      ...scoped.namespaces[key],
      default: key === ns,
    };
  }

  return scoped;
}

export function loadConfig(cwd: string = process.cwd(), agentName?: string): CortexConfig {
  const searchPaths = [
    resolve(cwd, '.fozikio', 'agent.yaml'),
    resolve(cwd, '.fozikio', 'config.yaml'),
    resolve(cwd, 'cortex.config.yaml'),
    resolve(cwd, 'config.yaml'),
  ];

  for (const configPath of searchPaths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = parseYaml(raw) as AgentConfig | CortexConfig;

        if (parsed && typeof parsed === 'object' && 'cortex' in parsed && parsed.cortex) {
          const cortex = parsed.cortex;
          let config: CortexConfig;

          // New agent.yaml format: cortex is a named map of { store, embed, primary }
          if (isNamedCortexMap(cortex)) {
            config = { ...DEFAULT_CONFIG, ...extractFromNamedCortexMap(cortex) };
          } else {
            // Legacy AgentConfig format: cortex is a flat CortexConfig object
            config = { ...DEFAULT_CONFIG, ...(cortex as Partial<CortexConfig>) };
          }

          // Apply agent scoping if agentName is provided
          if (agentName) {
            const agentParsed = parsed as AgentConfig;
            const entry = resolveAgentNamespace(agentParsed, agentName);
            if (!entry) {
              console.error(`[cortex-engine] Agent "${agentName}" not found in agents block.`);
              process.exit(1);
            }
            config = applyAgentScope(config, entry);
          }

          return config;
        }

        // Top-level CortexConfig format (no agents block possible)
        if (agentName) {
          console.error(`[cortex-engine] Agent "${agentName}" requested but config has no agents block.`);
          process.exit(1);
        }
        return { ...DEFAULT_CONFIG, ...(parsed as Partial<CortexConfig>) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cortex-engine] Failed to parse config at ${configPath}: ${message}`);
      }
    }
  }

  // No config found — use defaults
  if (agentName) {
    console.error(`[cortex-engine] Agent "${agentName}" requested but no config file found.`);
    process.exit(1);
  }
  console.error('[cortex-engine] No config file found, using defaults (sqlite + ollama)');
  return DEFAULT_CONFIG;
}
