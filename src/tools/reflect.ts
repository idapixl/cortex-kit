/**
 * reflect — synthesize what you know about a topic into a reflective passage.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';
import { str, optStr } from './_helpers.js';
import { extractKeywords } from '../engines/keywords.js';

export const reflectTool: ToolDefinition = {
  name: 'reflect',
  description: 'Synthesize what you know about a topic into a short reflective passage. Pulls related memories and generates a grounded reflection. The result is stored as a new observation for future retrieval.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic to reflect on' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['topic'],
  },
  async handler(args: Record<string, unknown>, ctx: ToolContext) {
    const topic = str(args, 'topic');
    const namespace = optStr(args, 'namespace');

    const store = ctx.namespaces.getStore(namespace);

    // Query related memories
    const topicEmbedding = await ctx.embed.embed(topic);
    const related = await store.findNearest(topicEmbedding, 5);

    // Build context from related memories
    const memoryContext = related
      .map(r => `- ${r.memory.name}: ${r.memory.definition}`)
      .join('\n');

    // LLM generates reflection
    const reflection = await ctx.llm.generate(
      `You are reflecting on the topic: "${topic}"\n\nRelated concepts from memory:\n${memoryContext || '(no related memories found)'}\n\nWrite a 2-4 sentence reflection that synthesizes these concepts and your understanding of the topic. Be honest about uncertainty.`,
      {
        temperature: 0.7,
        maxTokens: 300,
        systemPrompt: 'You are a reflective cognitive agent. You are reflecting on your own memories and experiences. Generate thoughtful, grounded reflections in first person based on the provided memory context. Do not confuse yourself with other people mentioned in the memories.',
      },
    );

    // Store reflection as observation
    const embedding = await ctx.embed.embed(reflection);
    const keywords = extractKeywords(`${topic} ${reflection}`);
    const provenance = ctx.session.getProvenance();

    const obsId = await store.putObservation({
      content: reflection,
      source_file: '',
      source_section: `reflection:${topic}`,
      salience: 6,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding,
      keywords,
      provenance,
    });

    return {
      topic,
      reflection,
      observation_id: obsId,
      related_memories: related.map(r => ({ id: r.memory.id, name: r.memory.name, score: r.score })),
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };
  },
};
