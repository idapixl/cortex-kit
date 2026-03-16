/**
 * CortexStore — storage abstraction for cortex-engine.
 *
 * Implementations: FirestoreCortexStore (cloud), SqliteCortexStore (local).
 * All methods operate on plain JS objects (no Firestore Timestamps, no VectorValue).
 */

import type {
  Memory,
  Observation,
  Edge,
  OpsEntry,
  OpsFilters,
  Signal,
  BeliefEntry,
  SearchResult,
  QueryFilter,
  FSRSData,
} from './types.js';

export interface CortexStore {
  // ─── Memory ──────────────────────────────────────────────────────────────────

  /** Store a new memory, returns its ID. */
  putMemory(memory: Omit<Memory, 'id'>): Promise<string>;

  /** Get a memory by ID. */
  getMemory(id: string): Promise<Memory | null>;

  /** Update specific fields on a memory. */
  updateMemory(id: string, updates: Partial<Omit<Memory, 'id'>>): Promise<void>;

  /** Find k nearest memories by embedding vector. Returns sorted by similarity desc. */
  findNearest(embedding: number[], limit: number): Promise<SearchResult[]>;

  /** Increment access_count, update last_accessed and FSRS fields. */
  touchMemory(id: string, fsrsUpdates: Partial<FSRSData>): Promise<void>;

  /** Get all memories (for batch operations like dream scoring). Use with caution. */
  getAllMemories(): Promise<Memory[]>;

  /** Get memories updated within the last N days, limited to M results. */
  getRecentMemories(days: number, limit: number): Promise<Memory[]>;

  // ─── Observation ─────────────────────────────────────────────────────────────

  /** Store a new observation, returns its ID. */
  putObservation(obs: Omit<Observation, 'id'>): Promise<string>;

  /** Get unprocessed observations (for dream consolidation). */
  getUnprocessedObservations(limit: number): Promise<Observation[]>;

  /** Mark an observation as processed. */
  markObservationProcessed(id: string): Promise<void>;

  // ─── Edge ────────────────────────────────────────────────────────────────────

  /** Store a new edge, returns its ID. */
  putEdge(edge: Omit<Edge, 'id'>): Promise<string>;

  /** Get all edges originating from a memory. */
  getEdgesFrom(memoryId: string): Promise<Edge[]>;

  /** Get all edges (both directions) for a set of memory IDs. */
  getEdgesForMemories(memoryIds: string[]): Promise<Edge[]>;

  // ─── Ops ─────────────────────────────────────────────────────────────────────

  /** Append an ops entry, returns its ID. */
  appendOps(entry: Omit<OpsEntry, 'id'>): Promise<string>;

  /** Query ops entries with composable filters. */
  queryOps(filters: OpsFilters): Promise<OpsEntry[]>;

  /** Update an ops entry (e.g., mark as done). */
  updateOps(id: string, updates: Partial<Omit<OpsEntry, 'id'>>): Promise<void>;

  // ─── Signal ──────────────────────────────────────────────────────────────────

  /** Store a signal, returns its ID. */
  putSignal(signal: Omit<Signal, 'id'>): Promise<string>;

  // ─── Belief ──────────────────────────────────────────────────────────────────

  /** Log a belief change. */
  putBelief(entry: Omit<BeliefEntry, 'id'>): Promise<string>;

  /** Get belief history for a concept. */
  getBeliefHistory(conceptId: string): Promise<BeliefEntry[]>;

  // ─── Generic ─────────────────────────────────────────────────────────────────

  /** Store a document in a named collection. Returns its ID. */
  put(collection: string, doc: Record<string, unknown>): Promise<string>;

  /** Get a document from a named collection by ID. */
  get(collection: string, id: string): Promise<Record<string, unknown> | null>;

  /** Update a document in a named collection by ID. Merges updates. */
  update(collection: string, id: string, updates: Record<string, unknown>): Promise<void>;

  /** Query documents from a named collection with filters. */
  query(
    collection: string,
    filters: QueryFilter[],
    options?: { limit?: number; orderBy?: string; orderDir?: 'asc' | 'desc' }
  ): Promise<Record<string, unknown>[]>;
}
