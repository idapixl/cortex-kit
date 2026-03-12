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

const config = loadConfig();

startServer(config).catch(err => {
  console.error('[cortex-engine] Fatal error:', err);
  process.exit(1);
});
