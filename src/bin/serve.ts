#!/usr/bin/env node
/**
 * cortex-engine MCP server entry point.
 *
 * Searches for a config file in standard locations, merges with defaults,
 * then starts the stdio MCP server.
 *
 * Config search order:
 *   1. .fozikio/config.yaml   (agent workspace)
 *   2. cortex.config.yaml     (project root)
 *   3. config.yaml            (project root)
 *   4. defaults               (sqlite + ollama)
 */

import { loadConfig } from './config-loader.js';
import { startServer } from '../mcp/server.js';

// Parse --agent flag from argv
let agentName: string | undefined;
const agentIdx = process.argv.indexOf('--agent');
if (agentIdx !== -1 && process.argv[agentIdx + 1]) {
  agentName = process.argv[agentIdx + 1];
}

const config = loadConfig(undefined, agentName);

startServer(config).catch(err => {
  console.error('[cortex-engine] Fatal error:', err);
  process.exit(1);
});
