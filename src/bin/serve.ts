#!/usr/bin/env node
/**
 * cortex-engine MCP server entry point.
 *
 * Searches for a config file in standard locations, merges with defaults,
 * then starts the stdio MCP server (default) or REST API server (--rest).
 *
 * Config search order:
 *   1. .fozikio/config.yaml   (agent workspace)
 *   2. cortex.config.yaml     (project root)
 *   3. config.yaml            (project root)
 *   4. defaults               (sqlite + ollama)
 */

import { loadConfig } from './config-loader.js';
import { createContext, startServer } from '../mcp/server.js';
import { startRestServer } from '../rest/server.js';

// Parse flags from argv
let agentName: string | undefined;
const agentIdx = process.argv.indexOf('--agent');
if (agentIdx !== -1 && process.argv[agentIdx + 1]) {
  agentName = process.argv[agentIdx + 1];
}

const useRest = process.argv.includes('--rest');
const portIdx = process.argv.indexOf('--port');
const restPort = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : 3000;
const tokenIdx = process.argv.indexOf('--token');
const restToken = tokenIdx !== -1 && process.argv[tokenIdx + 1]
  ? process.argv[tokenIdx + 1]
  : undefined;

let config;
try {
  config = loadConfig(undefined, agentName);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT') || msg.includes('not found')) {
    console.error('');
    console.error('  \u2717 agent.yaml not found');
    console.error('    run `fozikio init` first, or use --workspace <path>');
    console.error('');
  } else {
    console.error(`[cortex-engine] ${msg}`);
  }
  process.exit(1);
}

const start = useRest
  ? createContext(config).then(engine => startRestServer(engine, { port: restPort, token: restToken }))
  : startServer(config);

start.catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('EADDRINUSE') || msg.includes('locked')) {
    console.error('');
    console.error('  \u2717 port or store is locked');
    console.error('    another process may be running');
    console.error('');
  } else if (msg.includes('network') || msg.includes('fetch')) {
    console.error('');
    console.error('  \u2717 embedding model not available');
    console.error('    check your network connection and try again');
    console.error('');
  } else {
    console.error(`[cortex-engine] Fatal: ${msg}`);
  }
  process.exit(1);
});
