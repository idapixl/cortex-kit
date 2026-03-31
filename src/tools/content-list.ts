/**
 * content_list — list content pieces with optional filters.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';
import type { QueryFilter } from '../core/types.js';

const COLLECTION = 'content';

export const contentListTool: ToolDefinition = {
  name: 'content_list',
  description: 'List content pieces. Filter by state or type.',
  inputSchema: {
    type: 'object',
    properties: {
      state: {
        type: 'string',
        description: 'Filter by state (idea, draft, ready, published, archived)',
      },
      type: {
        type: 'string',
        description: 'Filter by type (blog, social, devto, reddit, thread, newsletter)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
      namespace: { type: 'string', description: 'Namespace (defaults to default)' },
    },
    required: [],
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
    const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;
    const namespace = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;

    const store = ctx.namespaces.getStore(namespace);

    const filters: QueryFilter[] = [];
    if (typeof args['state'] === 'string') {
      filters.push({ field: 'state', op: '==', value: args['state'] });
    }
    if (typeof args['type'] === 'string') {
      filters.push({ field: 'type', op: '==', value: args['type'] });
    }

    const results = await store.query(COLLECTION, filters, {
      orderBy: 'updated_at',
      orderDir: 'desc',
      limit,
    });

    const items = results.map((doc: Record<string, unknown>) => ({
      id: doc['id'] ?? null,
      title: doc['title'] ?? null,
      type: doc['type'] ?? null,
      state: doc['state'] ?? null,
      tags: doc['tags'] ?? [],
      source_ref: doc['source_ref'] ?? null,
      updated_at: doc['updated_at'] ?? null,
      created_at: doc['created_at'] ?? null,
    }));

    return { count: items.length, items };
  },
};
