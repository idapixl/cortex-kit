/**
 * config-utils.ts — shared config path utilities for cortex-engine CLI.
 *
 * Extracted from config-cmd.ts so agent-cmd.ts can reuse them.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Find the config file path — mirrors the search order in config-loader.ts.
 * Checks agent.yaml (new format) before config.yaml (legacy format).
 * Returns null if no config file exists (defaults are in use).
 */
export function findConfigPath(cwd: string = process.cwd()): string | null {
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
export function defaultConfigPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '.fozikio', 'agent.yaml');
}
