/**
 * threads_list — list thought threads with filters.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';
import type { QueryFilter } from '../core/types.js';

const COLLECTION = 'threads';

export const threadsListTool: ToolDefinition = {
  name: 'threads_list',
  description: "List thought threads. Filter by status (default 'open'), project, kind, or tag.",
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: "Filter by status: open, active, blocked, parked, resolved (default 'open')" },
      project: { type: 'string', description: 'Filter by project scope' },
      kind: { type: 'string', description: "Filter by kind: 'work' | 'exploration' | 'creative' | 'revenue' | 'meta'" },
      tag: { type: 'string', description: 'Filter by tag' },
      limit: { type: 'number', description: 'Max threads to return (default 50)' },
      namespace: { type: 'string', description: 'Namespace (defaults to default)' },
    },
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
    const status = typeof args['status'] === 'string' ? args['status'] : 'open';
    const project = typeof args['project'] === 'string' ? args['project'] : undefined;
    const kind = typeof args['kind'] === 'string' ? args['kind'] : undefined;
    const tag = typeof args['tag'] === 'string' ? args['tag'] : undefined;
    const limit = typeof args['limit'] === 'number' ? args['limit'] : 50;
    const namespace = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;

    const store = ctx.namespaces.getStore(namespace);

    // Build filters
    const filters: QueryFilter[] = [
      { field: 'status', op: '==', value: status },
    ];
    if (project) {
      filters.push({ field: 'project', op: '==', value: project });
    }
    if (tag) {
      filters.push({ field: 'tags', op: 'array-contains', value: tag });
    }

    const docs = await store.query(COLLECTION, filters, {
      limit,
      orderBy: 'priority',
      orderDir: 'desc',
    });

    // Client-side kind filter (not all stores support compound queries efficiently)
    let threads = docs.map(d => ({
      id: d['id'] as string,
      title: d['title'] as string,
      body: d['body'] as string,
      kind: d['kind'] as string,
      project: (d['project'] as string) ?? null,
      priority: d['priority'] as number,
      status: d['status'] as string,
      next_step: d['next_step'] as string | undefined,
      tags: d['tags'] as string[],
      updates_count: Array.isArray(d['updates']) ? d['updates'].length : 0,
      created_at: d['created_at'] as string,
      updated_at: d['updated_at'] as string,
    }));

    if (kind) {
      threads = threads.filter(t => t.kind === kind);
    }

    return {
      status,
      project: project ?? 'all',
      kind: kind ?? 'all',
      filter: tag ?? 'all',
      count: threads.length,
      threads,
    };
  },
};
