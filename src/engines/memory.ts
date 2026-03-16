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

  // Compute local density from k-NN scores.
  // Dense regions (neighbors all score high) → lower merge threshold to cluster
  // more aggressively. Sparse regions → raise threshold to be more conservative.
  const localDensity = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const densityAdjustment = (localDensity - 0.5) * 0.15; // range: roughly -0.075 to +0.075
  const adaptiveMergeThreshold = Math.max(0.70, Math.min(0.95, mergeThreshold + densityAdjustment));
  const adaptiveLinkThreshold = Math.max(0.35, Math.min(0.65, linkThreshold + densityAdjustment));

  let maxSimilarity = 0;
  let nearestId = '';

  for (const result of results) {
    if (result.score > maxSimilarity) {
      maxSimilarity = result.score;
      nearestId = result.memory.id;
    }
  }

  let decision: IngestDecision;
  if (maxSimilarity > adaptiveMergeThreshold) {
    decision = 'merge';
  } else if (maxSimilarity > adaptiveLinkThreshold) {
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
 * Compute cosine similarity between two equal-length vectors.
 * Returns 0 if either vector is zero-length.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Starting from a set of initial search results, traverse edges to activate
 * related concepts via BFS. Returns primary results augmented with activated
 * neighbors, ranked by combined activation score.
 *
 * Activation decays by ACTIVATION_DECAY (0.5) per hop, weighted by edge weight.
 * Max depth defaults to 2 hops.
 *
 * When queryEmbedding is provided, propagation is query-conditioned: branches
 * whose target memories are more similar to the query receive higher weight,
 * biasing traversal toward query-relevant parts of the graph (Synapse, 2601.02744).
 */
export async function spreadActivation(
  store: CortexStore,
  initial: SearchResult[],
  queryEmbedding?: number[],
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

      const targetId = edge.target_id;

      const existing = activated.get(targetId);

      // Fetch the memory so we can apply query-conditioned weighting
      const memory = await store.getMemory(targetId);
      if (!memory) continue;

      let propagatedScore = sourceResult.score * ACTIVATION_DECAY * edge.weight;

      // Query-conditioned weighting: bias toward query-relevant branches.
      // Clamp to [0.1, 1.0] — don't zero out irrelevant paths, just downweight them.
      if (queryEmbedding && memory.embedding.length > 0) {
        const relevance = cosineSimilarity(queryEmbedding, memory.embedding);
        propagatedScore *= Math.max(0.1, relevance);
      }

      if (!existing || existing.score < propagatedScore) {
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
 * GNN-style retrieval: for each candidate, compute aggregated embedding
 * by weighting with graph neighbors, then re-score against query.
 *
 * Algorithm:
 * 1. Fetch limit*2 initial candidates via ANN search.
 * 2. For each candidate, fetch up to 5 graph neighbors, compute a
 *    weighted mean embedding (0.6 self + 0.4 mean-neighbors).
 * 3. Re-score each candidate's aggregated embedding against the query.
 * 4. Return top `limit` results sorted by aggregated score.
 *
 * Candidates with no neighbors fall back to their original ANN score.
 */
export async function aggregatedRetrieval(
  store: CortexStore,
  queryEmbedding: number[],
  limit: number = 5,
): Promise<SearchResult[]> {
  const candidates = await store.findNearest(queryEmbedding, limit * 2);

  if (candidates.length === 0) return [];

  const reranked: Array<{ result: SearchResult; aggregatedScore: number }> = [];

  for (const candidate of candidates) {
    const edges = await store.getEdgesFrom(candidate.memory.id);

    if (edges.length === 0) {
      reranked.push({ result: candidate, aggregatedScore: candidate.score });
      continue;
    }

    // Fetch neighbor embeddings (cap at 5 to control cost)
    const neighborEmbeddings: number[][] = [];
    for (const edge of edges.slice(0, 5)) {
      const neighbor = await store.getMemory(edge.target_id);
      if (neighbor?.embedding?.length) {
        neighborEmbeddings.push(neighbor.embedding);
      }
    }

    if (neighborEmbeddings.length === 0) {
      reranked.push({ result: candidate, aggregatedScore: candidate.score });
      continue;
    }

    // Compute mean neighbor embedding
    const dim = neighborEmbeddings[0].length;
    const meanNeighbor = new Array<number>(dim).fill(0);
    for (const emb of neighborEmbeddings) {
      for (let i = 0; i < dim; i++) meanNeighbor[i] += emb[i];
    }
    for (let i = 0; i < dim; i++) meanNeighbor[i] /= neighborEmbeddings.length;

    // Get the candidate's own embedding for the aggregation step
    const candidateMem = await store.getMemory(candidate.memory.id);
    if (!candidateMem?.embedding?.length) {
      reranked.push({ result: candidate, aggregatedScore: candidate.score });
      continue;
    }

    // Aggregated = 0.6 * self + 0.4 * mean(neighbors)
    const aggregated = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      aggregated[i] = 0.6 * candidateMem.embedding[i] + 0.4 * meanNeighbor[i];
    }

    const aggregatedScore = cosineSimilarity(queryEmbedding, aggregated);
    reranked.push({ result: candidate, aggregatedScore });
  }

  return reranked
    .sort((a, b) => b.aggregatedScore - a.aggregatedScore)
    .slice(0, limit)
    .map(r => ({
      ...r.result,
      score: r.aggregatedScore,
      distance: 1 - r.aggregatedScore,
    }));
}

/**
 * Thousand Brains retrieval: run parallel retrievals from multiple query
 * formulations, vote on which memories appear across threads.
 *
 * Algorithm:
 * 1. Use the LLM to rephrase the query in 3 different ways.
 * 2. Embed each variant (plus the original) in parallel and run ANN search.
 * 3. Aggregate results via Borda count — memories appearing in more threads
 *    and at higher ranks score more highly.
 * 4. Return top `limit` results sorted by consensus count, then Borda score.
 *
 * LLM failure is non-fatal: falls back to the original query only.
 */
export async function multiAnchorRetrieval(
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  queryText: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  const variantsPrompt = [
    'Rephrase this query in 3 different ways, focusing on different aspects.',
    'Return a JSON array of 3 strings.',
    '',
    `Query: ${queryText}`,
  ].join('\n');

  let variants: string[];
  try {
    variants = await llm.generateJSON<string[]>(variantsPrompt, { temperature: 0.5, maxTokens: 200 });
    if (!Array.isArray(variants)) variants = [];
  } catch {
    variants = [];
  }

  // Always include the original query
  const allQueries = [queryText, ...variants.slice(0, 3)];

  // Run parallel retrievals
  const allResults = await Promise.all(
    allQueries.map(async (q) => {
      const embedding = await embed.embed(q);
      return store.findNearest(embedding, limit * 2);
    })
  );

  // Borda count: score each memory by how many threads found it and at what rank
  const votes = new Map<string, { result: SearchResult; score: number; count: number }>();

  for (const results of allResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const id = r.memory.id;
      const existing = votes.get(id);
      const bordaScore = results.length - rank; // higher rank = higher score

      if (existing) {
        existing.score += bordaScore;
        existing.count++;
        if (r.score > existing.result.score) {
          existing.result = r;
        }
      } else {
        votes.set(id, { result: r, score: bordaScore, count: 1 });
      }
    }
  }

  // Sort by vote count first (consensus), then by Borda score (rank quality)
  return Array.from(votes.values())
    .sort((a, b) => b.count - a.count || b.score - a.score)
    .slice(0, limit)
    .map(v => v.result);
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
    provenance: memory.provenance,
  };
}
