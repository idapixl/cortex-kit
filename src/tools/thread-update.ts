/**
 * thread_update — update a thread's status, content, or metadata.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';

const COLLECTION = 'threads';

export const threadUpdateTool: ToolDefinition = {
  name: 'thread_update',
  description: 'Update a thread — change status, edit title/body, add session refs, link memories.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Thread ID' },
      title: { type: 'string', description: 'New title' },
      body: { type: 'string', description: 'New body text' },
      kind: { type: 'string', description: "Thread kind: 'work' | 'exploration' | 'creative' | 'revenue' | 'meta'" },
      status: { type: 'string', description: 'New status: open, active, blocked, parked, resolved' },
      blocked_by: { type: 'string', description: 'What is blocking this thread — auto-sets status to blocked' },
      next_step: { type: 'string', description: 'Actionable next move' },
      update_note: { type: 'string', description: 'Progress note to append to updates log' },
      add_session_ref: { type: 'string', description: 'Session date to append' },
      project: { type: 'string', description: 'Set or change project scope' },
      add_memory_id: { type: 'string', description: 'Memory ID to link' },
      priority: { type: 'number', description: 'New priority 0-1' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags entirely' },
      namespace: { type: 'string', description: 'Namespace (defaults to default)' },
    },
    required: ['id'],
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
    const id = typeof args['id'] === 'string' ? args['id'] : '';
    if (!id) return { error: 'id is required' };

    const namespace = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;
    const store = ctx.namespaces.getStore(namespace);

    const existing = await store.get(COLLECTION, id);
    if (!existing) return { error: `Thread not found: ${id}` };

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };

    if (typeof args['title'] === 'string') updates['title'] = args['title'];
    if (typeof args['body'] === 'string') updates['body'] = args['body'];
    if (typeof args['kind'] === 'string') updates['kind'] = args['kind'];
    if (typeof args['status'] === 'string') updates['status'] = args['status'];
    if (typeof args['next_step'] === 'string') updates['next_step'] = args['next_step'];
    if (typeof args['project'] === 'string') updates['project'] = args['project'] || null;
    if (typeof args['priority'] === 'number') updates['priority'] = args['priority'];
    if (Array.isArray(args['tags'])) updates['tags'] = args['tags'];

    // Append to session_refs array
    if (typeof args['add_session_ref'] === 'string') {
      const refs = Array.isArray(existing['session_refs']) ? existing['session_refs'] as string[] : [];
      if (!refs.includes(args['add_session_ref'])) {
        updates['session_refs'] = [...refs, args['add_session_ref']];
      }
    }

    // Append to related_memory_ids array
    if (typeof args['add_memory_id'] === 'string') {
      const ids = Array.isArray(existing['related_memory_ids']) ? existing['related_memory_ids'] as string[] : [];
      if (!ids.includes(args['add_memory_id'])) {
        updates['related_memory_ids'] = [...ids, args['add_memory_id']];
      }
    }

    // Handle blocked_by — auto-set status
    if (typeof args['blocked_by'] === 'string') {
      updates['blocked_by'] = args['blocked_by'];
      updates['status'] = 'blocked';
    }

    // Append update note
    if (typeof args['update_note'] === 'string') {
      const existingUpdates = Array.isArray(existing['updates']) ? existing['updates'] as Record<string, unknown>[] : [];
      const entry: Record<string, unknown> = {
        timestamp: now,
        content: args['update_note'],
      };
      if (typeof args['add_session_ref'] === 'string') {
        entry['session_ref'] = args['add_session_ref'];
      }
      updates['updates'] = [...existingUpdates, entry];
    }

    await store.update(COLLECTION, id, updates);

    const updated = await store.get(COLLECTION, id);
    return { id, ...updated };
  },
};
