#!/usr/bin/env node
/**
 * fozikio CLI — setup and management for cortex-engine agents.
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
import { runDigest } from './digest-cmd.js';
import { runConfig } from './config-cmd.js';
import { runAgent } from './agent-cmd.js';
import { startServer } from '../mcp/server.js';

// ─── Help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.error(`fozikio — setup and management for cortex-engine agents

Usage:
  fozikio <command> [options]

Commands:
  init <name>   Scaffold a new agent workspace
  serve          Start the MCP server (stdio)
  config         View or edit configuration
  agent          Manage multi-agent registry
  digest         Process documents through cortex
  help           Show this help message

Serve options:
  --agent <name>  Scope server to a named agent's namespace

Agent subcommands:
  agent add <name>      Register a new agent
  agent list            List registered agents
  agent generate-mcp    Write multi-agent .mcp.json

Init options:
  --store sqlite|firestore     Storage backend (default: sqlite)
  --embed ollama|vertex|openai   Embedding provider (default: ollama)
  --llm ollama|gemini|anthropic|openai   LLM provider (default: ollama)
  --namespace <name>           Default namespace name (default: default)
  --here                       Scaffold into current directory
  --obsidian                   Create .obsidian/ structure

Examples:
  fozikio init my-agent
  fozikio init my-agent --store firestore --embed vertex --llm gemini
  fozikio init --here --obsidian
  fozikio serve
  fozikio config
  fozikio config --store sqlite --embed ollama
  fozikio digest path/to/file.md
  fozikio digest --pending
`);
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv;

switch (command) {
  case 'init':
    runInit(rest);
    break;

  case 'serve': {
    let agentName: string | undefined;
    const agentIdx = rest.indexOf('--agent');
    if (agentIdx !== -1 && rest[agentIdx + 1]) {
      agentName = rest[agentIdx + 1];
    }
    (async () => {
      const config = loadConfig(undefined, agentName);
      await startServer(config);
    })().catch(err => {
      console.error('[fozikio] Fatal error:', err);
      process.exit(1);
    });
    break;
  }

  case 'config':
    runConfig(rest).catch(err => {
      console.error('[fozikio] Config error:', err);
      process.exit(1);
    });
    break;

  case 'agent':
    runAgent(rest).catch(err => {
      console.error('[fozikio] Agent error:', err);
      process.exit(1);
    });
    break;

  case 'digest':
    runDigest(rest).catch(err => {
      console.error('[fozikio] Digest error:', err);
      process.exit(1);
    });
    break;

  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;

  case undefined:
    console.error('[fozikio] No command provided.\n');
    printHelp();
    process.exit(1);
    break;

  default:
    console.error(`[fozikio] Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
