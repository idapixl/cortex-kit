/**
 * content_create — create a new content piece in the pipeline.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';

const COLLECTION = 'content';

export const contentCreateTool: ToolDefinition = {
  name: 'content_create',
  description: 'Create a content piece — idea, blog draft, social post, dev.to article. Starts the content pipeline.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Content title' },
      body: { type: 'string', description: 'Content body (markdown)' },
      type: {
        type: 'string',
        enum: ['blog', 'social', 'devto', 'reddit', 'thread', 'newsletter'],
        description: 'Content type (default: blog)',
      },
      state: {
        type: 'string',
        enum: ['idea', 'draft', 'ready'],
        description: 'Initial state (default: idea)',
      },
      source_ref: { type: 'string', description: 'What inspired this (logbook date, workshop file)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags' },
      namespace: { type: 'string', description: 'Namespace (defaults to default)' },
    },
    required: ['title', 'body'],
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
    const title = typeof args['title'] === 'string' ? args['title'] : '';
    const body = typeof args['body'] === 'string' ? args['body'] : '';
    if (!title) return { error: 'title is required' };
    if (!body) return { error: 'body is required' };

    const contentType = typeof args['type'] === 'string' ? args['type'] : 'blog';
    const state = typeof args['state'] === 'string' ? args['state'] : 'idea';
    const sourceRef = typeof args['source_ref'] === 'string' ? args['source_ref'] : undefined;
    const tags = Array.isArray(args['tags']) ? (args['tags'] as string[]).map(String) : [];
    const namespace = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;

    const store = ctx.namespaces.getStore(namespace);
    const now = new Date().toISOString();

    const doc: Record<string, unknown> = {
      type: contentType,
      state,
      title,
      body,
      tags,
      created_at: now,
      updated_at: now,
    };

    if (sourceRef !== undefined) doc['source_ref'] = sourceRef;

    const id = await store.put(COLLECTION, doc);

    return { id, title, type: contentType, state };
  },
};
