#!/usr/bin/env node
/**
 * cortex-kit CLI — setup and management for cortex-engine agents.
 *
 * Commands:
 *   init <name>     Scaffold a new agent workspace
 *   serve            Start the MCP server
 *   config           View or edit configuration
 *   digest           Process documents through cortex
 *   help             Show help
 */

import { loadConfig } from './config-loader.js';
import { runInit } from './init.js';
import { startServer } from '../mcp/server.js';

// ─── Help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.error(`cortex-kit — setup and management for cortex-engine agents

Usage:
  cortex-kit <command> [options]

Commands:
  init <name>   Scaffold a new agent workspace
  serve          Start the MCP server (stdio)
  config         View resolved configuration
  help           Show this help message

Init options:
  --store sqlite|firestore     Storage backend (default: sqlite)
  --embed ollama|vertex|openai   Embedding provider (default: ollama)
  --llm ollama|gemini|anthropic|openai   LLM provider (default: ollama)
  --namespace <name>           Default namespace name (default: default)
  --here                       Scaffold into current directory
  --obsidian                   Create .obsidian/ structure

Examples:
  cortex-kit init my-agent
  cortex-kit init my-agent --store firestore --embed vertex --llm gemini
  cortex-kit init --here --obsidian
  cortex-kit serve
  cortex-kit config
`);
}

// ─── Config command ────────────────────────────────────────────────────────

function runConfig(): void {
  const config = loadConfig();
  // Output resolved config to stdout as JSON
  console.log(JSON.stringify(config, null, 2));
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv;

switch (command) {
  case 'init':
    runInit(rest);
    break;

  case 'serve':
    (async () => {
      const config = loadConfig();
      await startServer(config);
    })().catch(err => {
      console.error('[cortex-kit] Fatal error:', err);
      process.exit(1);
    });
    break;

  case 'config':
    runConfig();
    break;

  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;

  case undefined:
    console.error('[cortex-kit] No command provided.\n');
    printHelp();
    process.exit(1);
    break;

  default:
    console.error(`[cortex-kit] Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
