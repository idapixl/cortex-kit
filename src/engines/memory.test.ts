/**
 * Tests for aggregatedRetrieval and multiAnchorRetrieval.
 *
 * Uses in-memory mock stores — no real DB or network calls.
 */

import { describe, it, expect, vi } from 'vitest';
import { aggregatedRetrieval, multiAnchorRetrieval } from './memory.js';
import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import type { Memory, SearchResult, Edge } from '../core/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMemory(id: string, embedding: number[]): Memory {
  return {
    id,
    name: `Memory ${id}`,
    definition: `Definition of ${id}`,
    category: 'observation',
    salience: 0.5,
    confidence: 0.8,
    access_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    last_accessed: new Date(),
    source_files: [],
    embedding,
    tags: [],
    fsrs: {
      stability: 1,
      difficulty: 0.5,
      reps: 0,
      lapses: 0,
      state: 'new',
      last_review: null,
    },
  };
}

function makeSearchResult(memory: Memory, score: number): SearchResult {
  return {
    memory: {
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
    },
    score,
    distance: 1 - score,
  };
}

/** Minimal mock store. Only methods called by the two new functions are implemented. */
function makeMockStore(
  memories: Map<string, Memory>,
  edges: Map<string, Edge[]>,
  findNearestImpl: (embedding: number[], limit: number) => SearchResult[],
): CortexStore {
  return {
    findNearest: vi.fn((embedding, limit) => Promise.resolve(findNearestImpl(embedding, limit))),
    getMemory: vi.fn((id: string) => Promise.resolve(memories.get(id) ?? null)),
    getEdgesFrom: vi.fn((id: string) => Promise.resolve(edges.get(id) ?? [])),
    // Unused methods — stubbed to satisfy the interface
    putMemory: vi.fn(),
    updateMemory: vi.fn(),
    touchMemory: vi.fn(),
    getAllMemories: vi.fn(),
    getRecentMemories: vi.fn(),
    putObservation: vi.fn(),
    getUnprocessedObservations: vi.fn(),
    markObservationProcessed: vi.fn(),
    putEdge: vi.fn(),
    getEdgesForMemories: vi.fn(),
    appendOps: vi.fn(),
    queryOps: vi.fn(),
    updateOps: vi.fn(),
    putSignal: vi.fn(),
    putBelief: vi.fn(),
    getBeliefHistory: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    query: vi.fn(),
  } as unknown as CortexStore;
}

// ─── aggregatedRetrieval ───────────────────────────────────────────────────────

describe('aggregatedRetrieval', () => {
  it('returns empty array when findNearest returns nothing', async () => {
    const store = makeMockStore(new Map(), new Map(), () => []);
    const result = await aggregatedRetrieval(store, [1, 0], 3);
    expect(result).toEqual([]);
  });

  it('falls back to original score when candidate has no edges', async () => {
    const mem = makeMemory('a', [1, 0]);
    const sr = makeSearchResult(mem, 0.9);
    const memories = new Map([['a', mem]]);
    const edges = new Map<string, Edge[]>();
    const store = makeMockStore(memories, edges, () => [sr]);

    const result = await aggregatedRetrieval(store, [1, 0], 1);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe('a');
    expect(result[0].score).toBeCloseTo(0.9);
  });

  it('aggregates neighbor embeddings and re-scores correctly', async () => {
    // Query points exactly along [1, 0].
    // Memory A embedding: [1, 0]. Memory B (neighbor) embedding: [0, 1].
    // Aggregated A = 0.6*[1,0] + 0.4*[0,1] = [0.6, 0.4].
    // cosine([1,0], [0.6,0.4]) = 0.6 / sqrt(0.52) ≈ 0.832 — lower than 1.0.
    // This confirms aggregation ran and blended in the neighbor.
    const memA = makeMemory('a', [1, 0]);
    const memB = makeMemory('b', [0, 1]);
    const memories = new Map([['a', memA], ['b', memB]]);

    const edgeA: Edge = {
      id: 'e1',
      source_id: 'a',
      target_id: 'b',
      relation: 'related',
      weight: 1,
      evidence: 'test',
      created_at: new Date(),
    };
    const edges = new Map([['a', [edgeA]]]);

    const srA = makeSearchResult(memA, 1.0);
    const store = makeMockStore(memories, edges, () => [srA]);

    const result = await aggregatedRetrieval(store, [1, 0], 1);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe('a');
    // Aggregated score should be less than 1.0 due to neighbor blending
    expect(result[0].score).toBeLessThan(1.0);
    expect(result[0].score).toBeGreaterThan(0.5);
    // distance must mirror score
    expect(result[0].distance).toBeCloseTo(1 - result[0].score);
  });

  it('respects limit and returns top-N by aggregated score', async () => {
    const mems = ['a', 'b', 'c'].map((id, i) => makeMemory(id, [1 - i * 0.3, i * 0.3]));
    const memories = new Map(mems.map(m => [m.id, m]));
    const edges = new Map<string, Edge[]>();

    const searchResults = mems.map((m, i) => makeSearchResult(m, 0.9 - i * 0.1));
    const store = makeMockStore(memories, edges, () => searchResults);

    const result = await aggregatedRetrieval(store, [1, 0], 2);
    expect(result).toHaveLength(2);
    // Results must be sorted descending
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
  });
});

// ─── multiAnchorRetrieval ─────────────────────────────────────────────────────

describe('multiAnchorRetrieval', () => {
  function makeEmbedProvider(fixed: number[]): EmbedProvider {
    return { embed: vi.fn(() => Promise.resolve(fixed)) };
  }

  function makeLLMProvider(variants: string[]): LLMProvider {
    return {
      generate: vi.fn(),
      generateJSON: vi.fn(() => Promise.resolve(variants)),
      name: 'mock',
      modelId: 'mock-model',
    } as unknown as LLMProvider;
  }

  it('returns empty array when no candidates found across all queries', async () => {
    const store = makeMockStore(new Map(), new Map(), () => []);
    const embed = makeEmbedProvider([1, 0]);
    const llm = makeLLMProvider(['variant 1', 'variant 2', 'variant 3']);

    const result = await multiAnchorRetrieval(store, embed, llm, 'test query', 5);
    expect(result).toEqual([]);
  });

  it('falls back gracefully when LLM throws', async () => {
    const memA = makeMemory('a', [1, 0]);
    const memories = new Map([['a', memA]]);
    const srA = makeSearchResult(memA, 0.9);
    const store = makeMockStore(memories, new Map(), () => [srA]);

    const embed = makeEmbedProvider([1, 0]);
    const llm: LLMProvider = {
      generate: vi.fn(),
      generateJSON: vi.fn(() => Promise.reject(new Error('LLM offline'))),
      name: 'mock',
      modelId: 'mock',
    } as unknown as LLMProvider;

    // Should still return results using only the original query
    const result = await multiAnchorRetrieval(store, embed, llm, 'test query', 5);
    expect(result).toHaveLength(1);
    expect(result[0].memory.id).toBe('a');
  });

  it('ranks by consensus — memories in more query threads rank higher', async () => {
    // Memory 'a' appears in results for ALL query variants (high consensus).
    // Memory 'b' appears in only one result set.
    // Even though 'b' has higher raw cosine score, 'a' should rank first.
    const memA = makeMemory('a', [1, 0]);
    const memB = makeMemory('b', [0, 1]);
    const memories = new Map([['a', memA], ['b', memB]]);

    const srA = makeSearchResult(memA, 0.9);
    const srB = makeSearchResult(memB, 0.95); // higher raw score than A

    let callCount = 0;
    const store = makeMockStore(memories, new Map(), () => {
      callCount++;
      return callCount === 1 ? [srB, srA] : [srA];
    });

    const embed = makeEmbedProvider([1, 0]);
    const llm = makeLLMProvider(['variant 1', 'variant 2', 'variant 3']);

    const result = await multiAnchorRetrieval(store, embed, llm, 'query', 5);

    // 'a' should rank first — it appears across all 4 query threads
    expect(result[0].memory.id).toBe('a');
    expect(result[1].memory.id).toBe('b');
  });

  it('respects limit', async () => {
    const mems = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) =>
      makeMemory(id, [1 - i * 0.1, i * 0.1]),
    );
    const memories = new Map(mems.map(m => [m.id, m]));
    const searchResults = mems.map((m, i) => makeSearchResult(m, 0.9 - i * 0.05));

    const store = makeMockStore(memories, new Map(), () => searchResults);
    const embed = makeEmbedProvider([1, 0]);
    const llm = makeLLMProvider([]);

    const result = await multiAnchorRetrieval(store, embed, llm, 'query', 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
