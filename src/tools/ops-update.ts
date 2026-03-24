/**
 * ops_update — update an operational log entry's status or content.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';
import type { OpsStatus } from '../core/types.js';
import { str, optStr } from './_helpers.js';
import { extractKeywords } from '../engines/keywords.js';

export const opsUpdateTool: ToolDefinition = {
  name: 'ops_update',
  description:
    'Update an operational log entry — change its status (active/done/stale), amend content, or update continuity fields (next, blocked). ' +
    'Use ops_query() to find the entry ID first.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the ops entry to update' },
      status: { type: 'string', enum: ['active', 'done', 'stale'], description: 'New status' },
      content: { type: 'string', description: 'Updated content' },
      next: { type: 'string', description: 'Update what should happen next' },
      blocked: { type: 'string', description: 'Update what is blocking progress' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['id'],
  },
  async handler(args: Record<string, unknown>, ctx: ToolContext) {
    const id = str(args, 'id');
    const namespace = optStr(args, 'namespace');
    const store = ctx.namespaces.getStore(namespace);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const newStatus = optStr(args, 'status') as OpsStatus | undefined;
    const newContent = optStr(args, 'content');
    const newNext = optStr(args, 'next');
    const newBlocked = optStr(args, 'blocked');

    if (newStatus) updates['status'] = newStatus;
    if (newContent) {
      updates['content'] = newContent;
      updates['keywords'] = extractKeywords(newContent);
    }
    if (newNext) updates['next'] = newNext;
    if (newBlocked) updates['blocked'] = newBlocked;

    await store.updateOps(id, updates as Parameters<typeof store.updateOps>[1]);

    return {
      id,
      updated: Object.keys(updates).filter(k => k !== 'updated_at'),
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };
  },
};
