/**
 * ops_append — log an operational breadcrumb with type-based auto-expiry.
 *
 * TTL varies by entry type:
 *   log: 90 days, instruction: 14 days, handoff: 14 days,
 *   milestone: 180 days, decision: 365 days.
 */

import type { ToolDefinition } from '../mcp/tools.js';
import type { OpsEntryType, OpsSessionType, OpsInstructionMeta } from '../core/types.js';
import { OPS_TTL_DAYS } from '../core/types.js';
import { extractKeywords } from '../engines/keywords.js';
import { str, optStr } from './_helpers.js';

export const opsAppendTool: ToolDefinition = {
  name: 'ops_append',
  description:
    'Log an operational event. Types: log (session breadcrumb, 90-day TTL), instruction (directive for future session, 14-day TTL), ' +
    'handoff (session transition with structured metadata, 14-day TTL), milestone (achievement, 180-day TTL), decision (architecture/design choice, 365-day TTL). ' +
    'Use project= to scope entries for multi-session work. Use ops_query() to read back entries, ops_update() to change status.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'What happened or what needs to happen' },
      type: {
        type: 'string',
        enum: ['log', 'instruction', 'handoff', 'milestone', 'decision'],
        description: "Entry type — defaults to log. Use 'decision' for architecture/design choices (365-day TTL)",
      },
      project: { type: 'string', description: 'Project scope (cortex, x402, social-pipeline, etc.) — null for general' },
      session_type: {
        type: 'string',
        enum: ['interactive', 'cron'],
        description: 'Session origin — defaults to interactive',
      },
      seed_type: { type: 'string', description: 'Cron seed name (ops-health, trading, creative, etc.)' },
      blocked: { type: 'string', description: 'What is blocking progress' },
      next: { type: 'string', description: 'What should happen next' },
      instruction_meta: {
        type: 'object',
        description: 'Instruction metadata (type=instruction only): { model?, skip?, target_project? }',
        properties: {
          model: { type: 'string' },
          skip: { type: 'array', items: { type: 'string' } },
          target_project: { type: 'string' },
        },
      },
      handoff_meta: {
        type: 'object',
        description: 'Handoff metadata (type=handoff only): { completed[], in_flight[], next_actions[], decisions_made[], open_threads[] }',
        properties: {
          completed: { type: 'array', items: { type: 'string' } },
          in_flight: { type: 'array', items: { type: 'string' } },
          next_actions: { type: 'array', items: { type: 'string' } },
          decisions_made: { type: 'array', items: { type: 'string' } },
          open_threads: { type: 'array', items: { type: 'string' } },
        },
      },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['content'],
  },
  async handler(args, ctx) {
    const content = str(args, 'content');
    const type = (optStr(args, 'type') ?? 'log') as OpsEntryType;
    const project = optStr(args, 'project') ?? null;
    const namespace = optStr(args, 'namespace');
    const sessionType = (optStr(args, 'session_type') ?? 'interactive') as OpsSessionType;
    const seedType = optStr(args, 'seed_type');
    const blocked = optStr(args, 'blocked');
    const next = optStr(args, 'next');

    const store = ctx.namespaces.getStore(namespace);
    const provenance = ctx.session.getProvenance();

    // Build keywords: extract from content + auto-add structured tags
    const contentKeywords = extractKeywords(content);
    const autoTags: string[] = [type];
    if (project) autoTags.push(project.toLowerCase());
    if (seedType) autoTags.push(seedType.toLowerCase());
    if (sessionType) autoTags.push(sessionType);
    const keywords = [...new Set([...contentKeywords, ...autoTags])].slice(0, 20);

    const now = new Date();
    const ttlDays = OPS_TTL_DAYS[type] ?? 90;
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

    const entry: Parameters<typeof store.appendOps>[0] = {
      content,
      type,
      status: 'active',
      project,
      session_ref: provenance.model_id,
      keywords,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      provenance,
      session_type: sessionType,
    };

    // Optional fields — only set if provided
    if (seedType) entry.seed_type = seedType;
    if (blocked) entry.blocked = blocked;
    if (next) entry.next = next;

    if (type === 'instruction' && args['instruction_meta']) {
      entry.instruction_meta = args['instruction_meta'] as OpsInstructionMeta;
    }
    if (type === 'handoff' && args['handoff_meta']) {
      const meta = args['handoff_meta'] as Record<string, unknown>;
      entry.handoff_meta = {
        completed: Array.isArray(meta.completed) ? meta.completed.map(String) : [],
        in_flight: Array.isArray(meta.in_flight) ? meta.in_flight.map(String) : [],
        next_actions: Array.isArray(meta.next_actions) ? meta.next_actions.map(String) : [],
        decisions_made: Array.isArray(meta.decisions_made) ? meta.decisions_made.map(String) : [],
        open_threads: Array.isArray(meta.open_threads) ? meta.open_threads.map(String) : [],
      };
    }

    const id = await store.appendOps(entry);

    return {
      id,
      type,
      project,
      session_type: sessionType,
      ttl_days: ttlDays,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      keywords,
    };
  },
};
