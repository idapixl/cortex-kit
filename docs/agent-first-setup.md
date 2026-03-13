# Agent-First Setup Guide

cortex-kit is designed so an AI agent can set up, understand, and extend its own workspace from the first prompt.

## Quick Start: 30 Seconds to a Working Agent

Open Claude Code (or any MCP-compatible agent) in an empty directory and say:

```
Set up a cortex workspace for a research agent using sqlite and ollama
```

The agent runs:

```bash
npx cortex-kit init my-agent --store sqlite --embed ollama --llm ollama
```

That's it. The agent now has:
- A `.fozikio/config.yaml` defining its cognitive engine
- A `.mcp.json` wiring cortex into its tool system
- A `CLAUDE.md` teaching it every cortex tool and cognitive pattern
- `.claude/hooks/` enforcing good cognitive habits automatically
- `.claude/skills/` with reusable workflows it can invoke and extend

## What the Agent Learns From Each File

### CLAUDE.md — The Agent's Instruction Manual

When the agent reads `CLAUDE.md`, it immediately understands:
- All 15+ cognitive tools (`query`, `observe`, `believe`, `wander`, etc.)
- Usage patterns (query before working, observe when learning, dream to consolidate)
- Which hooks are installed and why they exist
- Which skills are available

This file IS the agent's self-awareness. It's written for agents to read, not humans to browse.

### .claude/hooks/ — Automatic Cognitive Patterns

The agent reads hook source files and understands the patterns they enforce:

| Hook | What the agent learns |
|------|----------------------|
| `cognitive-grounding.sh` | "I should `query()` cortex before doing evaluation, design, or review work" |
| `observe-first.sh` | "I should call `observe()` before writing to memory directories" |
| `cortex-telemetry.sh` | "My retrieval patterns are being tracked for quality feedback" |
| `session-lifecycle.sh` | "Session state resets on startup — I start fresh each time" |
| `project-board-gate.sh` | "I need to update the project board before pushing code" |

Hooks are plain shell scripts with comment headers. The agent reads the comments to understand *why* the pattern exists, not just that it fires.

### .claude/skills/ — Templates the Agent Can Read and Extend

Each skill has a `SKILL.md` with frontmatter and a clear structure. The agent learns:
- How skills are formatted (name, description, sections)
- What workflows already exist
- How to write NEW skills when the user asks

### .fozikio/config.yaml — Self-Modifiable Config

The agent can read and update its own configuration:
- Switch embedding providers (`ollama` to `vertex`)
- Add namespaces for different knowledge domains
- Change storage backends (`sqlite` to `firestore`)

### AGENTS.md — Team Context

If the workspace has multiple agents, `AGENTS.md` defines the roster. The agent knows who else is in the workspace and what they do.

## Example Prompts

### Initial Setup

```
Set up a cortex workspace for a trading agent using vertex AI and firestore
```

```
Initialize a personal knowledge agent with obsidian integration
```

### Creating Skills

```
Create a skill that helps me analyze GitHub issues
```

The agent reads the existing `cortex-query/SKILL.md` as a template, then writes a new skill directory with the same structure.

### Adding Hooks

```
Add a hook that reminds me to journal at the end of each session
```

The agent reads existing hooks in `.claude/hooks/`, understands the event/JSON protocol, and writes a new `.sh` file.

### Changing Configuration

```
Switch from ollama to Anthropic for embeddings
```

The agent updates `.fozikio/config.yaml` directly.

```
Add a research namespace separate from my default namespace
```

The agent adds a new namespace block with its own tool set and collection prefix.

### Connecting Agents

```
Connect this agent to my trading agent via A2A
```

The agent adds A2A peer configuration to `config.yaml`.

## Agent Self-Modification Patterns

The scaffolded workspace is designed for agents to extend:

| User Says | Agent Does |
|-----------|-----------|
| "Write me a skill for X" | Reads existing skill as template, creates new `skills/X/SKILL.md` |
| "Add a hook that does Y" | Reads existing hooks for protocol format, writes new `.claude/hooks/Y.sh` |
| "Use Anthropic instead of Ollama" | Updates `.fozikio/config.yaml` embed/llm fields |
| "Add a research namespace" | Adds namespace block to config with appropriate tools |
| "Install plugin X" | Adds plugin entry to config, installs package |

## The Self-Bootstrapping Loop

This is what makes cortex-kit different from a static config generator:

1. **`cortex-kit init`** creates the workspace
2. **Agent reads `CLAUDE.md`** and understands cortex tools
3. **Agent uses cortex** — queries, observes, builds memory
4. **Agent can teach the user** about cortex because it understands the system
5. **Agent can extend cortex** — new skills, hooks, namespaces, plugins
6. **Agent can create new agents** that also have cortex, closing the loop

The setup *is* the documentation *is* the agent's identity. There's no separate "getting started" phase — the agent is productive from its first message.

## What Changes for Agent-Driven vs Manual Setup

Nothing structurally. `cortex-kit init` produces identical output whether a human or an agent runs it. The difference is in how the output is consumed:

- **Human reads README** to understand the system, then configures manually
- **Agent reads CLAUDE.md** and is immediately operational, then extends the workspace as the user asks

The CLAUDE.md template, skill files, and hook comments are all written with this dual audience in mind — clear enough for humans, structured enough for agents.
