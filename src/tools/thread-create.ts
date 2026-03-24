/**
 * thread_create — create a new thought thread.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';

const COLLECTION = 'threads_v2';

export const threadCreateTool: ToolDefinition = {
  name: 'thread_create',
  description: 'Create a new thought thread for tracking ongoing questions, explorations, or topics.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short thread name' },
      body: { type: 'string', description: 'Current state description' },
      kind: { type: 'string', description: "Thread kind: 'work' | 'exploration' | 'creative' | 'revenue' | 'meta'" },
      tags: { type: 'array', items: { type: 'string' }, description: 'Array of tags' },
      priority: { type: 'number', description: 'Priority 0-1 (default 0.5)' },
      project: { type: 'string', description: 'Project scope for filtered queries' },
      next_step: { type: 'string', description: 'Actionable next move' },
      namespace: { type: 'string', description: 'Namespace (defaults to default)' },
    },
    required: ['title', 'body'],
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
    const title = typeof args['title'] === 'string' ? args['title'] : '';
    const body = typeof args['body'] === 'string' ? args['body'] : '';
    if (!title) return { error: 'title is required' };
    if (!body) return { error: 'body is required' };

    const kind = typeof args['kind'] === 'string' ? args['kind'] : 'exploration';
    const project = typeof args['project'] === 'string' ? args['project'] : null;
    const tags = Array.isArray(args['tags']) ? args['tags'] as string[] : [];
    const priority = typeof args['priority'] === 'number' ? args['priority'] : 0.5;
    const nextStep = typeof args['next_step'] === 'string' ? args['next_step'] : undefined;
    const namespace = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;

    const store = ctx.namespaces.getStore(namespace);
    const now = new Date().toISOString();

    const doc: Record<string, unknown> = {
      title,
      body,
      kind,
      project,
      tags,
      status: 'open',
      priority,
      updates: [],
      session_refs: [],
      related_memory_ids: [],
      created_at: now,
      updated_at: now,
    };
    if (nextStep !== undefined) doc['next_step'] = nextStep;

    const id = await store.put(COLLECTION, doc);

    const result: Record<string, unknown> = { id, title, body, kind, project, status: 'open', priority };

    // Gate: warn if next_step or project is missing — threads without these tend to become stale
    const warnings: string[] = [];
    if (!nextStep) warnings.push('Missing next_step — threads without a concrete next action tend to go stale. Consider using observe() or wonder() instead if this is speculative.');
    if (!project) warnings.push('Missing project — unscoped threads are harder to find and maintain.');
    if (warnings.length > 0) result['warnings'] = warnings;

    return result;
  },
};
