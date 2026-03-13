/**
 * ScopedStore — a CortexStore wrapper that prefixes generic collection names.
 *
 * Each namespace gets its own underlying CortexStore instance (created by
 * NamespaceManager) so typed tables (memories, observations, etc.) are already
 * isolated by the store's namespace prefix. ScopedStore's only job is to
 * prefix the generic put/get/query collection names so that arbitrary
 * collections written by one namespace don't collide with another.
 */

import type { CortexStore } from '../core/store.js';
import type {
  Memory,
  Observation,
  Edge,
  OpsEntry,
  OpsFilters,
  Signal,
  BeliefEntry,
  SearchResult,
  FSRSData,
  QueryFilter,
} from '../core/types.js';

export class ScopedStore implements CortexStore {
  constructor(
    private readonly inner: CortexStore,
    private readonly prefix: string,
  ) {}

  // ─── Memory — delegate directly (store instance is already namespace-scoped) ─

  putMemory(memory: Omit<Memory, 'id'>): Promise<string> {
    return this.inner.putMemory(memory);
  }

  getMemory(id: string): Promise<Memory | null> {
    return this.inner.getMemory(id);
  }

  updateMemory(id: string, updates: Partial<Omit<Memory, 'id'>>): Promise<void> {
    return this.inner.updateMemory(id, updates);
  }

  findNearest(embedding: number[], limit: number): Promise<SearchResult[]> {
    return this.inner.findNearest(embedding, limit);
  }

  touchMemory(id: string, fsrsUpdates: Partial<FSRSData>): Promise<void> {
    return this.inner.touchMemory(id, fsrsUpdates);
  }

  getAllMemories(): Promise<Memory[]> {
    return this.inner.getAllMemories();
  }

  // ─── Observation ──────────────────────────────────────────────────────────

  putObservation(obs: Omit<Observation, 'id'>): Promise<string> {
    return this.inner.putObservation(obs);
  }

  getUnprocessedObservations(limit: number): Promise<Observation[]> {
    return this.inner.getUnprocessedObservations(limit);
  }

  markObservationProcessed(id: string): Promise<void> {
    return this.inner.markObservationProcessed(id);
  }

  // ─── Edge ─────────────────────────────────────────────────────────────────

  putEdge(edge: Omit<Edge, 'id'>): Promise<string> {
    return this.inner.putEdge(edge);
  }

  getEdgesFrom(memoryId: string): Promise<Edge[]> {
    return this.inner.getEdgesFrom(memoryId);
  }

  getEdgesForMemories(memoryIds: string[]): Promise<Edge[]> {
    return this.inner.getEdgesForMemories(memoryIds);
  }

  // ─── Ops ──────────────────────────────────────────────────────────────────

  appendOps(entry: Omit<OpsEntry, 'id'>): Promise<string> {
    return this.inner.appendOps(entry);
  }

  queryOps(filters: OpsFilters): Promise<OpsEntry[]> {
    return this.inner.queryOps(filters);
  }

  updateOps(id: string, updates: Partial<Omit<OpsEntry, 'id'>>): Promise<void> {
    return this.inner.updateOps(id, updates);
  }

  // ─── Signal ───────────────────────────────────────────────────────────────

  putSignal(signal: Omit<Signal, 'id'>): Promise<string> {
    return this.inner.putSignal(signal);
  }

  // ─── Belief ───────────────────────────────────────────────────────────────

  putBelief(entry: Omit<BeliefEntry, 'id'>): Promise<string> {
    return this.inner.putBelief(entry);
  }

  getBeliefHistory(conceptId: string): Promise<BeliefEntry[]> {
    return this.inner.getBeliefHistory(conceptId);
  }

  // ─── Generic — prefix the collection name ─────────────────────────────────

  put(collection: string, doc: Record<string, unknown>): Promise<string> {
    return this.inner.put(this.prefix + collection, doc);
  }

  get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    return this.inner.get(this.prefix + collection, id);
  }

  update(collection: string, id: string, updates: Record<string, unknown>): Promise<void> {
    return this.inner.update(this.prefix + collection, id, updates);
  }

  query(
    collection: string,
    filters: QueryFilter[],
    options?: { limit?: number; orderBy?: string; orderDir?: 'asc' | 'desc' },
  ): Promise<Record<string, unknown>[]> {
    return this.inner.query(this.prefix + collection, filters, options);
  }
}
