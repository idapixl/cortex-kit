/**
 * FirestoreCortexStore — cloud Firestore-backed implementation of CortexStore.
 *
 * Uses firebase-admin for Firestore access. Vector search uses Firestore native
 * findNearest() for production-grade similarity search.
 * Dates stored as Firestore Timestamps. Embeddings stored as VectorValue.
 *
 * This is the cloud counterpart to SqliteCortexStore. Both implement the same
 * CortexStore interface, so engines work identically on either backend.
 */

import type { Firestore, CollectionReference, DocumentData, FieldValue as FieldValueType } from '@google-cloud/firestore';
import type { CortexStore } from '../core/store.js';
import type {
  Memory,
  MemorySummary,
  Observation,
  Edge,
  OpsEntry,
  OpsFilters,
  Signal,
  BeliefEntry,
  SearchResult,
  FSRSData,
  QueryFilter,
  ModelProvenance,
} from '../core/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a JS Date to a plain Date for Firestore (Firestore accepts Date objects natively). */
function toTimestamp(d: Date | undefined | null): Date {
  if (!d) return new Date();
  return d instanceof Date ? d : new Date(String(d));
}

/** Convert a Firestore Timestamp to JS Date. */
function toDate(t: unknown): Date {
  if (!t) return new Date();
  if (t instanceof Date) return t;
  if (typeof t === 'object' && t !== null && 'toDate' in t && typeof (t as { toDate: () => Date }).toDate === 'function') {
    return (t as { toDate: () => Date }).toDate();
  }
  if (typeof t === 'string') return new Date(t);
  return new Date();
}

/** Convert a Firestore Timestamp to JS Date or null. */
function toDateOrNull(t: unknown): Date | null {
  if (t === null || t === undefined) return null;
  return toDate(t);
}

/** Extract provenance from a Firestore doc. */
function docProvenance(data: DocumentData): ModelProvenance | undefined {
  if (!data.provenance?.model_id) return undefined;
  return {
    model_id: data.provenance.model_id,
    model_family: data.provenance.model_family ?? '',
    client: data.provenance.client ?? '',
    agent: data.provenance.agent ?? '',
  };
}

/**
 * Module-level FieldValue reference. Set by the store constructor from injected or
 * dynamically imported firebase-admin. This avoids the ESM dual-package hazard where
 * @google-cloud/firestore installed in the engine creates different class identities
 * than the one installed in the host service.
 */
let _FieldValue: typeof FieldValueType | null = null;

/** Convert a number[] embedding to Firestore VectorValue. */
function toVector(embedding: number[]): unknown {
  if (!_FieldValue) throw new Error('FirestoreCortexStore not initialized — FieldValue not set');
  return _FieldValue.vector(embedding);
}

/** Convert a Firestore VectorValue back to number[]. */
function fromVector(v: unknown): number[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  // VectorValue has a toArray() method
  if (typeof v === 'object' && v !== null && 'toArray' in v && typeof (v as { toArray: () => number[] }).toArray === 'function') {
    return (v as { toArray: () => number[] }).toArray();
  }
  return [];
}

// ─── Doc converters ───────────────────────────────────────────────────────────

function docToMemory(id: string, data: DocumentData): Memory {
  return {
    id,
    name: data.name ?? '',
    definition: data.definition ?? '',
    category: data.category ?? 'topic',
    salience: data.salience ?? 0.5,
    confidence: data.confidence ?? 0.5,
    access_count: data.access_count ?? 0,
    created_at: toDate(data.created_at),
    updated_at: toDate(data.updated_at),
    last_accessed: toDate(data.last_accessed),
    source_files: data.source_files ?? [],
    embedding: fromVector(data.embedding),
    tags: data.tags ?? [],
    fsrs: {
      stability: data.fsrs?.stability ?? 3.1262,
      difficulty: data.fsrs?.difficulty ?? 7.2102,
      reps: data.fsrs?.reps ?? 0,
      lapses: data.fsrs?.lapses ?? 0,
      state: data.fsrs?.state ?? 'new',
      last_review: toDateOrNull(data.fsrs?.last_review),
    },
    faded: data.faded ?? false,
    salience_original: data.salience_original ?? undefined,
    provenance: docProvenance(data),
  };
}

function docToSummary(id: string, data: DocumentData): MemorySummary {
  return {
    id,
    name: data.name ?? '',
    definition: data.definition ?? '',
    category: data.category ?? 'topic',
    salience: data.salience ?? 0.5,
    confidence: data.confidence ?? 0.5,
    access_count: data.access_count ?? 0,
    updated_at: toDate(data.updated_at),
    tags: data.tags ?? [],
    fsrs: {
      stability: data.fsrs?.stability ?? 3.1262,
      difficulty: data.fsrs?.difficulty ?? 7.2102,
      reps: data.fsrs?.reps ?? 0,
      lapses: data.fsrs?.lapses ?? 0,
      state: data.fsrs?.state ?? 'new',
      last_review: toDateOrNull(data.fsrs?.last_review),
    },
    provenance: docProvenance(data),
  };
}

function docToObservation(id: string, data: DocumentData): Observation {
  return {
    id,
    content: data.content ?? '',
    source_file: data.source_file ?? '',
    source_section: data.source_section ?? '',
    salience: data.salience ?? 0.5,
    processed: data.processed ?? false,
    prediction_error: data.prediction_error ?? null,
    created_at: toDate(data.created_at),
    updated_at: toDate(data.updated_at),
    embedding: data.embedding ? fromVector(data.embedding) : null,
    keywords: data.keywords ?? [],
    provenance: docProvenance(data),
  };
}

function docToEdge(id: string, data: DocumentData): Edge {
  return {
    id,
    source_id: data.source_id ?? '',
    target_id: data.target_id ?? '',
    relation: data.relation ?? 'related',
    weight: data.weight ?? 1.0,
    evidence: data.evidence ?? '',
    created_at: toDate(data.created_at),
  };
}

function docToOps(id: string, data: DocumentData): OpsEntry {
  return {
    id,
    content: data.content ?? '',
    type: data.type ?? 'log',
    status: data.status ?? 'active',
    project: data.project ?? null,
    session_ref: data.session_ref ?? '',
    keywords: data.keywords ?? [],
    created_at: toDate(data.created_at),
    updated_at: toDate(data.updated_at),
    expires_at: toDate(data.expires_at),
    provenance: docProvenance(data),
  };
}

function docToBelief(id: string, data: DocumentData): BeliefEntry {
  return {
    id,
    concept_id: data.concept_id ?? '',
    old_definition: data.old_definition ?? '',
    new_definition: data.new_definition ?? '',
    reason: data.reason ?? '',
    changed_at: toDate(data.changed_at),
  };
}

// ─── Provenance to Firestore format ──────────────────────────────────────────

function provenanceData(p?: ModelProvenance): Record<string, string> | undefined {
  if (!p) return undefined;
  return {
    model_id: p.model_id,
    model_family: p.model_family,
    client: p.client,
    agent: p.agent,
  };
}

// ─── FirestoreCortexStore ─────────────────────────────────────────────────────

export interface FirestoreStoreOptions {
  /** GCP project ID (required if not using Application Default Credentials) */
  projectId?: string;
  /** Firestore database ID (default: '(default)') */
  databaseId?: string;
  /** Namespace prefix for collection names (for multi-tenant isolation) */
  namespace?: string;
}

export class FirestoreCortexStore implements CortexStore {
  private db: Firestore;
  private ns: string;

  constructor(db: Firestore, namespace?: string, fieldValue?: typeof FieldValueType) {
    this.db = db;
    this.ns = namespace ?? '';
    if (fieldValue) {
      _FieldValue = fieldValue;
    }
  }

  /** Inject the host's FieldValue to avoid ESM dual-package class identity issues. */
  static setFieldValue(fv: typeof FieldValueType): void {
    _FieldValue = fv;
  }

  /** Create a FirestoreCortexStore from firebase-admin Firestore instance. */
  static fromFirestore(db: Firestore, namespace?: string, fieldValue?: typeof FieldValueType): FirestoreCortexStore {
    return new FirestoreCortexStore(db, namespace, fieldValue);
  }

  /** Get the prefixed collection name. */
  private col(name: string): CollectionReference {
    const collName = this.ns ? `${this.ns}_${name}` : name;
    return this.db.collection(collName);
  }

  // ─── Memory ────────────────────────────────────────────────────────────────

  async putMemory(memory: Omit<Memory, 'id'>): Promise<string> {
    const ref = this.col('memories').doc();
    await ref.set({
      name: memory.name,
      definition: memory.definition,
      category: memory.category,
      salience: memory.salience,
      confidence: memory.confidence,
      access_count: memory.access_count,
      created_at: toTimestamp(memory.created_at),
      updated_at: toTimestamp(memory.updated_at),
      last_accessed: toTimestamp(memory.last_accessed),
      source_files: memory.source_files ?? [],
      embedding: memory.embedding?.length ? toVector(memory.embedding) : [],
      tags: memory.tags ?? [],
      fsrs: {
        stability: memory.fsrs.stability,
        difficulty: memory.fsrs.difficulty,
        reps: memory.fsrs.reps,
        lapses: memory.fsrs.lapses,
        state: memory.fsrs.state,
        last_review: memory.fsrs.last_review ? toTimestamp(memory.fsrs.last_review) : null,
      },
      faded: memory.faded ?? false,
      salience_original: memory.salience_original ?? null,
      provenance: provenanceData(memory.provenance) ?? null,
    });
    return ref.id;
  }

  async getMemory(id: string): Promise<Memory | null> {
    const snap = await this.col('memories').doc(id).get();
    if (!snap.exists) return null;
    return docToMemory(snap.id, snap.data()!);
  }

  async updateMemory(id: string, updates: Partial<Omit<Memory, 'id'>>): Promise<void> {
    const data: Record<string, unknown> = {};

    if (updates.name !== undefined) data.name = updates.name;
    if (updates.definition !== undefined) data.definition = updates.definition;
    if (updates.category !== undefined) data.category = updates.category;
    if (updates.salience !== undefined) data.salience = updates.salience;
    if (updates.confidence !== undefined) data.confidence = updates.confidence;
    if (updates.access_count !== undefined) data.access_count = updates.access_count;
    if (updates.updated_at !== undefined) data.updated_at = toTimestamp(updates.updated_at);
    if (updates.last_accessed !== undefined) data.last_accessed = toTimestamp(updates.last_accessed);
    if (updates.source_files !== undefined) data.source_files = updates.source_files;
    if (updates.embedding !== undefined) data.embedding = updates.embedding.length ? toVector(updates.embedding) : [];
    if (updates.tags !== undefined) data.tags = updates.tags;
    if (updates.faded !== undefined) data.faded = updates.faded;
    if (updates.salience_original !== undefined) data.salience_original = updates.salience_original;
    if (updates.fsrs !== undefined) {
      data['fsrs.stability'] = updates.fsrs.stability;
      data['fsrs.difficulty'] = updates.fsrs.difficulty;
      data['fsrs.reps'] = updates.fsrs.reps;
      data['fsrs.lapses'] = updates.fsrs.lapses;
      data['fsrs.state'] = updates.fsrs.state;
      data['fsrs.last_review'] = updates.fsrs.last_review ? toTimestamp(updates.fsrs.last_review) : null;
    }
    if (updates.provenance !== undefined) {
      data.provenance = provenanceData(updates.provenance) ?? null;
    }

    if (Object.keys(data).length === 0) return;
    await this.col('memories').doc(id).update(data);
  }

  async findNearest(embedding: number[], limit: number): Promise<SearchResult[]> {
    const snap = await this.col('memories')
      .where('faded', '!=', true)
      .findNearest({
        vectorField: 'embedding',
        queryVector: toVector(embedding) as import('@google-cloud/firestore').VectorValue,
        limit,
        distanceMeasure: 'COSINE',
        distanceResultField: '_distance',
      })
      .get();

    return snap.docs.map(doc => {
      const data = doc.data();
      const distance = (data._distance as number) ?? 1;
      return {
        memory: docToSummary(doc.id, data),
        score: 1 - distance,
        distance,
      };
    });
  }

  async touchMemory(id: string, fsrsUpdates: Partial<FSRSData>): Promise<void> {
    const data: Record<string, unknown> = {
      access_count: _FieldValue!.increment(1),
      last_accessed: toTimestamp(new Date()),
      updated_at: toTimestamp(new Date()),
    };

    if (fsrsUpdates.stability !== undefined) data['fsrs.stability'] = fsrsUpdates.stability;
    if (fsrsUpdates.difficulty !== undefined) data['fsrs.difficulty'] = fsrsUpdates.difficulty;
    if (fsrsUpdates.reps !== undefined) data['fsrs.reps'] = fsrsUpdates.reps;
    if (fsrsUpdates.lapses !== undefined) data['fsrs.lapses'] = fsrsUpdates.lapses;
    if (fsrsUpdates.state !== undefined) data['fsrs.state'] = fsrsUpdates.state;
    if (fsrsUpdates.last_review !== undefined) {
      data['fsrs.last_review'] = fsrsUpdates.last_review ? toTimestamp(fsrsUpdates.last_review) : null;
    }

    await this.col('memories').doc(id).update(data);
  }

  async getAllMemories(): Promise<Memory[]> {
    const snap = await this.col('memories').get();
    return snap.docs.map(doc => docToMemory(doc.id, doc.data()));
  }

  // ─── Observation ───────────────────────────────────────────────────────────

  async putObservation(obs: Omit<Observation, 'id'>): Promise<string> {
    const ref = this.col('observations').doc();
    await ref.set({
      content: obs.content,
      source_file: obs.source_file,
      source_section: obs.source_section,
      salience: obs.salience,
      processed: obs.processed,
      prediction_error: obs.prediction_error ?? null,
      created_at: toTimestamp(obs.created_at),
      updated_at: toTimestamp(obs.updated_at),
      embedding: obs.embedding?.length ? toVector(obs.embedding) : null,
      keywords: obs.keywords ?? [],
      provenance: provenanceData(obs.provenance) ?? null,
    });
    return ref.id;
  }

  async getUnprocessedObservations(limit: number): Promise<Observation[]> {
    const snap = await this.col('observations')
      .where('processed', '==', false)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .get();

    return snap.docs.map(doc => docToObservation(doc.id, doc.data()));
  }

  async markObservationProcessed(id: string): Promise<void> {
    await this.col('observations').doc(id).update({
      processed: true,
      updated_at: toTimestamp(new Date()),
    });
  }

  // ─── Edge ──────────────────────────────────────────────────────────────────

  async putEdge(edge: Omit<Edge, 'id'>): Promise<string> {
    const ref = this.col('edges').doc();
    await ref.set({
      source_id: edge.source_id,
      target_id: edge.target_id,
      relation: edge.relation,
      weight: edge.weight,
      evidence: edge.evidence,
      created_at: toTimestamp(edge.created_at),
    });
    return ref.id;
  }

  async getEdgesFrom(memoryId: string): Promise<Edge[]> {
    const snap = await this.col('edges')
      .where('source_id', '==', memoryId)
      .get();

    return snap.docs.map(doc => docToEdge(doc.id, doc.data()));
  }

  async getEdgesForMemories(memoryIds: string[]): Promise<Edge[]> {
    if (memoryIds.length === 0) return [];

    // Firestore 'in' queries are limited to 30 values.
    // Query both directions and deduplicate.
    const CHUNK = 30;
    const seen = new Set<string>();
    const edges: Edge[] = [];

    for (let i = 0; i < memoryIds.length; i += CHUNK) {
      const chunk = memoryIds.slice(i, i + CHUNK);

      const [srcSnap, tgtSnap] = await Promise.all([
        this.col('edges').where('source_id', 'in', chunk).get(),
        this.col('edges').where('target_id', 'in', chunk).get(),
      ]);

      for (const doc of [...srcSnap.docs, ...tgtSnap.docs]) {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          edges.push(docToEdge(doc.id, doc.data()));
        }
      }
    }

    return edges;
  }

  // ─── Ops ───────────────────────────────────────────────────────────────────

  async appendOps(entry: Omit<OpsEntry, 'id'>): Promise<string> {
    const ref = this.col('ops').doc();
    await ref.set({
      content: entry.content,
      type: entry.type,
      status: entry.status,
      project: entry.project ?? null,
      session_ref: entry.session_ref,
      keywords: entry.keywords ?? [],
      created_at: toTimestamp(entry.created_at),
      updated_at: toTimestamp(entry.updated_at),
      expires_at: toTimestamp(entry.expires_at),
      provenance: provenanceData(entry.provenance) ?? null,
    });
    return ref.id;
  }

  async queryOps(filters: OpsFilters): Promise<OpsEntry[]> {
    let q: FirebaseFirestore.Query = this.col('ops');

    if (filters.type) q = q.where('type', '==', filters.type);
    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.project) q = q.where('project', '==', filters.project);
    if (filters.keyword) q = q.where('keywords', 'array-contains', filters.keyword);
    if (filters.days) {
      const cutoff = new Date(Date.now() - filters.days * 86400_000);
      q = q.where('created_at', '>=', toTimestamp(cutoff));
    }

    q = q.orderBy('created_at', 'desc');
    if (filters.limit) q = q.limit(filters.limit);

    const snap = await q.get();
    return snap.docs.map(doc => docToOps(doc.id, doc.data()));
  }

  async updateOps(id: string, updates: Partial<Omit<OpsEntry, 'id'>>): Promise<void> {
    const data: Record<string, unknown> = {
      updated_at: toTimestamp(new Date()),
    };

    if (updates.content !== undefined) data.content = updates.content;
    if (updates.type !== undefined) data.type = updates.type;
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.project !== undefined) data.project = updates.project;
    if (updates.keywords !== undefined) data.keywords = updates.keywords;
    if (updates.expires_at !== undefined) data.expires_at = toTimestamp(updates.expires_at);

    await this.col('ops').doc(id).update(data);
  }

  // ─── Signal ────────────────────────────────────────────────────────────────

  async putSignal(signal: Omit<Signal, 'id'>): Promise<string> {
    const ref = this.col('signals').doc();
    await ref.set({
      type: signal.type,
      description: signal.description,
      concept_ids: signal.concept_ids ?? [],
      priority: signal.priority,
      resolved: signal.resolved,
      created_at: toTimestamp(signal.created_at),
      resolution_note: signal.resolution_note ?? null,
    });
    return ref.id;
  }

  // ─── Belief ────────────────────────────────────────────────────────────────

  async putBelief(entry: Omit<BeliefEntry, 'id'>): Promise<string> {
    const ref = this.col('beliefs').doc();
    await ref.set({
      concept_id: entry.concept_id,
      old_definition: entry.old_definition,
      new_definition: entry.new_definition,
      reason: entry.reason,
      changed_at: toTimestamp(entry.changed_at),
    });
    return ref.id;
  }

  async getBeliefHistory(conceptId: string): Promise<BeliefEntry[]> {
    const snap = await this.col('beliefs')
      .where('concept_id', '==', conceptId)
      .orderBy('changed_at', 'asc')
      .get();

    return snap.docs.map(doc => docToBelief(doc.id, doc.data()));
  }

  // ─── Generic ───────────────────────────────────────────────────────────────

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const id = (doc['id'] as string) ?? undefined;
    const ref = id ? this.col(collection).doc(id) : this.col(collection).doc();
    const { id: _id, ...rest } = doc;
    await ref.set(rest, { merge: true });
    return ref.id;
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const snap = await this.col(collection).doc(id).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() } as Record<string, unknown>;
  }

  async update(collection: string, id: string, updates: Record<string, unknown>): Promise<void> {
    const { id: _id, ...rest } = updates;
    await this.col(collection).doc(id).update(rest);
  }

  async query(
    collection: string,
    filters: QueryFilter[],
    options?: { limit?: number; orderBy?: string; orderDir?: 'asc' | 'desc' }
  ): Promise<Record<string, unknown>[]> {
    let q: FirebaseFirestore.Query = this.col(collection);

    for (const f of filters) {
      q = q.where(f.field, f.op as FirebaseFirestore.WhereFilterOp, f.value);
    }

    if (options?.orderBy) {
      q = q.orderBy(options.orderBy, options.orderDir ?? 'asc');
    }

    if (options?.limit) {
      q = q.limit(options.limit);
    }

    const snap = await q.get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}
