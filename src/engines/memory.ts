/**
 * Memory engine — prediction error gating, HyDE query expansion,
 * spreading activation, and memory conversion utilities.
 *
 * Pure cognitive functions — no storage imports, no side effects.
 * All state access goes through CortexStore / providers passed as arguments.
 */

import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import type {
  Memory,
  MemorySummary,
  SearchResult,
  ActivationResult,
  GateResult,
  IngestDecision,
} from '../core/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Similarity threshold above which a new observation is treated as a duplicate. */
export const SIMILARITY_MERGE = 0.85;

/** Similarity threshold above which a new observation is linked to an existing memory. */
export const SIMILARITY_LINK = 0.50;

/** Activation score decay factor per hop during spreading activation. */
export const ACTIVATION_DECAY = 0.5;

/** Maximum BFS depth for spreading activation traversal. */
export const MAX_ACTIVATION_DEPTH = 2;

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Determine how a new observation should be ingested based on similarity
 * to existing memories.
 *
 * - merge (>mergeThreshold): too similar to existing memory (duplicate risk)
 * - link (>linkThreshold): moderately similar — store and link as related
 * - novel: nothing close — candidate for a new memory concept
 *
 * Thresholds can be overridden per namespace via config.
 */
export async function predictionErrorGate(
  store: CortexStore,
  embedding: number[],
  thresholds?: { merge?: number; link?: number }
): Promise<GateResult> {
  const mergeThreshold = thresholds?.merge ?? SIMILARITY_MERGE;
  const linkThreshold = thresholds?.link ?? SIMILARITY_LINK;

  const results = await store.findNearest(embedding, 5);

  if (results.length === 0) {
    return { decision: 'novel', max_similarity: 0 };
  }

  let maxSimilarity = 0;
  let nearestId = '';

  for (const result of results) {
    if (result.score > maxSimilarity) {
      maxSimilarity = result.score;
      nearestId = result.memory.id;
    }
  }

  let decision: IngestDecision;
  if (maxSimilarity > mergeThreshold) {
    decision = 'merge';
  } else if (maxSimilarity > linkThreshold) {
    decision = 'link';
  } else {
    decision = 'novel';
  }

  return {
    decision,
    nearest_id: decision !== 'novel' ? nearestId : undefined,
    max_similarity: maxSimilarity,
  };
}

/**
 * Expand a user query using Hypothetical Document Embeddings (HyDE).
 *
 * Instead of embedding the raw query, asks the LLM to generate a
 * hypothetical passage that would answer the query, then embeds THAT.
 * This dramatically improves recall for concept-level questions.
 */
export async function hydeExpand(
  query: string,
  llm: LLMProvider,
  embed: EmbedProvider
): Promise<number[]> {
  const hypothetical = await llm.generate(
    `Write a short, factual passage (2-3 sentences) that would answer this question or describe this concept. Do not include any preamble — just the passage.\n\nQuery: ${query}`,
    {
      temperature: 0.3,
      maxTokens: 200,
      systemPrompt: 'You are a knowledge retrieval assistant. Generate hypothetical document passages for semantic search.',
    }
  );

  return embed.embed(hypothetical);
}

/**
 * Starting from a set of initial search results, traverse edges to activate
 * related concepts via BFS. Returns primary results augmented with activated
 * neighbors, ranked by combined activation score.
 *
 * Activation decays by ACTIVATION_DECAY (0.5) per hop, weighted by edge weight.
 * Max depth defaults to 2 hops.
 */
export async function spreadActivation(
  store: CortexStore,
  initial: SearchResult[],
  depth: number = MAX_ACTIVATION_DEPTH
): Promise<ActivationResult[]> {
  const activated = new Map<string, ActivationResult>();

  // Seed with initial matches
  for (const result of initial) {
    activated.set(result.memory.id, {
      ...result,
      hop_count: 0,
      activation_path: [result.memory.id],
    });
  }

  // BFS traversal
  async function traverse(ids: string[], currentDepth: number): Promise<void> {
    if (currentDepth >= depth || ids.length === 0) return;

    // Get all edges from current frontier (batch)
    const edges = await store.getEdgesForMemories(ids);

    const nextIds: string[] = [];

    for (const edge of edges) {
      // Only follow forward edges (source_id in our frontier)
      if (!ids.includes(edge.source_id)) continue;

      const sourceResult = activated.get(edge.source_id);
      if (!sourceResult) continue;

      const propagatedScore = sourceResult.score * ACTIVATION_DECAY * edge.weight;
      const targetId = edge.target_id;

      const existing = activated.get(targetId);
      if (!existing || existing.score < propagatedScore) {
        const memory = await store.getMemory(targetId);
        if (!memory) continue;

        activated.set(targetId, {
          memory: memoryToSummary(memory),
          score: propagatedScore,
          distance: 1 - propagatedScore,
          hop_count: currentDepth + 1,
          activation_path: [...sourceResult.activation_path, targetId],
        });
        nextIds.push(targetId);
      }
    }

    await traverse(nextIds, currentDepth + 1);
  }

  await traverse(initial.map((r) => r.memory.id), 0);

  return Array.from(activated.values())
    .sort((a, b) => b.score - a.score);
}

/**
 * Convert a full Memory to a MemorySummary (strips embedding and other large fields).
 */
export function memoryToSummary(memory: Memory): MemorySummary {
  return {
    id: memory.id,
    name: memory.name,
    definition: memory.definition,
    category: memory.category,
    salience: memory.salience,
    confidence: memory.confidence,
    access_count: memory.access_count,
    updated_at: memory.updated_at,
    tags: memory.tags,
    fsrs: memory.fsrs,
  };
}
