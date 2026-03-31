/**
 * content_update — update an existing content piece.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';

const COLLECTION = 'content';

export const contentUpdateTool: ToolDefinition = {
  name: 'content_update',
  description: 'Update a content piece — change state, edit body, add platform versions, mark published.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Content ID' },
      state: {
        type: 'string',
        enum: ['idea', 'draft', 'ready', 'published', 'archived'],
        description: 'New state',
      },
      title: { type: 'string', description: 'New title' },
      body: { type: 'string', description: 'New body' },
      add_platform_version: {
        type: 'object',
        properties: {
          platform: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['platform', 'content'],
        description: 'Add or update a platform-adapted version',
      },
      add_published_url: { type: 'string', description: 'URL where content was published' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags' },
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
    if (!existing) {
      return { error: `Content not found: ${id}` };
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updated_at: now };

    if (typeof args['state'] === 'string') {
      updates['state'] = args['state'];
      if (args['state'] === 'published' && !existing['published_at']) {
        updates['published_at'] = now;
      }
    }
    if (typeof args['title'] === 'string') updates['title'] = args['title'];
    if (typeof args['body'] === 'string') updates['body'] = args['body'];
    if (Array.isArray(args['tags'])) updates['tags'] = (args['tags'] as string[]).map(String);

    // Handle platform version addition
    if (args['add_platform_version'] !== null && typeof args['add_platform_version'] === 'object') {
      const pv = args['add_platform_version'] as Record<string, unknown>;
      const platform = typeof pv['platform'] === 'string' ? pv['platform'] : '';
      const content = typeof pv['content'] === 'string' ? pv['content'] : '';
      if (platform && content) {
        const existingVersions = typeof existing['platform_versions'] === 'object' && existing['platform_versions'] !== null
          ? existing['platform_versions'] as Record<string, unknown>
          : {};
        updates['platform_versions'] = { ...existingVersions, [platform]: content };
      }
    }

    // Handle published URL addition
    if (typeof args['add_published_url'] === 'string') {
      const existingUrls = Array.isArray(existing['published_urls'])
        ? existing['published_urls'] as string[]
        : [];
      if (!existingUrls.includes(args['add_published_url'])) {
        updates['published_urls'] = [...existingUrls, args['add_published_url']];
      }
    }

    await store.update(COLLECTION, id, updates);

    // Read back the updated doc
    const updated = await store.get(COLLECTION, id);
    if (!updated) {
      return { error: 'Failed to read back updated document' };
    }

    return {
      id,
      title: updated['title'] ?? null,
      type: updated['type'] ?? null,
      state: updated['state'] ?? null,
      tags: updated['tags'] ?? [],
      platform_versions: updated['platform_versions'] ?? {},
      published_urls: updated['published_urls'] ?? [],
      updated_at: updated['updated_at'] ?? null,
    };
  },
};
