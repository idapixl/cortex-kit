/**
 * goal_set — set a desired future state with forward prediction error.
 *
 * Goals represent what the agent wants to be true, not what is true.
 * The gap between a goal and current beliefs produces a forward PE signal
 * that biases consolidation and exploration toward goal-relevant content.
 */

import type { ToolDefinition, ToolContext } from '../mcp/tools.js';
import { extractKeywords } from '../engines/keywords.js';

export const goalTool: ToolDefinition = {
  name: 'goal_set',
  description:
    'Set a goal — a desired future state that generates forward prediction error. ' +
    'Unlike beliefs (what is true) or observations (what happened), goals represent ' +
    'what the agent wants to be true. The gap between current beliefs and goals ' +
    'creates a persistent value signal that biases consolidation and exploration ' +
    'toward goal-relevant content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      goal: {
        type: 'string',
        description: 'Description of the desired future state.',
      },
      priority: {
        type: 'number',
        description: 'Goal priority 0.0-1.0 (default: 0.7).',
      },
      namespace: {
        type: 'string',
        description: 'Namespace (default: default).',
      },
    },
    required: ['goal'],
  },

  async handler(args: Record<string, unknown>, ctx: ToolContext) {
    const goalText = typeof args['goal'] === 'string' ? args['goal'] : '';
    if (!goalText) return { error: 'goal is required' };

    const priority = typeof args['priority'] === 'number' ? args['priority'] : 0.7;
    const nsName = typeof args['namespace'] === 'string' ? args['namespace'] : undefined;
    const store = ctx.namespaces.getStore(nsName);

    const embedding = await ctx.embed.embed(goalText);
    const keywords = extractKeywords(goalText);

    // Check for existing similar goals to avoid duplicates
    const nearest = await store.findNearest(embedding, 3);
    const existingGoals = nearest.filter(
      r => r.memory.category === 'goal' && r.score > 0.80
    );

    if (existingGoals.length > 0) {
      const existing = existingGoals[0];
      await store.updateMemory(existing.memory.id, {
        definition: goalText,
        salience: priority,
        embedding,
        updated_at: new Date(),
        tags: keywords,
      });

      return {
        action: 'updated',
        goal_id: existing.memory.id,
        previous: existing.memory.definition,
        current: goalText,
        priority,
        namespace: nsName ?? ctx.namespaces.getDefaultNamespace(),
      };
    }

    // Forward PE: gap between this goal and the nearest existing belief.
    // A goal with no related beliefs has maximum forward PE (= 1.0).
    const beliefResults = nearest.filter(r => r.memory.category !== 'goal');
    const forwardPE = beliefResults.length > 0
      ? 1 - beliefResults[0].score
      : 1.0;

    const name = goalText.length > 60 ? goalText.slice(0, 60) : goalText;

    const goalId = await store.putMemory({
      name,
      definition: goalText,
      category: 'goal',
      salience: priority,
      confidence: 1.0, // Goals are intentional, not uncertain
      access_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
      last_accessed: new Date(),
      source_files: [],
      embedding,
      tags: keywords,
      fsrs: {
        stability: 30,
        difficulty: 0.3,
        reps: 0,
        lapses: 0,
        state: 'review' as const,
        last_review: new Date(),
      },
      memory_origin: 'organic',
    });

    return {
      action: 'created',
      goal_id: goalId,
      goal: goalText,
      priority,
      forward_pe: forwardPE,
      nearest_belief: beliefResults[0]?.memory.name ?? null,
      namespace: nsName ?? ctx.namespaces.getDefaultNamespace(),
    };
  },
};
