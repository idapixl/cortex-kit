/**
 * SqliteCortexStore — local SQLite-backed implementation of CortexStore.
 *
 * Uses better-sqlite3 for synchronous SQLite access wrapped in async interface.
 * Vector search uses brute-force cosine similarity (sufficient for <10k memories).
 * Dates stored as ISO-8601 strings. Arrays stored as JSON text.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
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

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: query has ${a.length} dims but stored has ${b.length} dims. ` +
      `Check that your embed provider matches the dimensions used when memories were stored.`
    );
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function toISO(d: Date | undefined | null): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : String(d);
}

function toDate(s: string | null): Date {
  return s ? new Date(s) : new Date();
}

function toDateOrNull(s: string | null): Date | null {
  return s ? new Date(s) : null;
}

function parseJSON<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function prov(row: { prov_model_id?: string | null; prov_model_family?: string | null; prov_client?: string | null; prov_agent?: string | null }): ModelProvenance | undefined {
  if (!row.prov_model_id) return undefined;
  return {
    model_id: row.prov_model_id!,
    model_family: row.prov_model_family ?? '',
    client: row.prov_client ?? '',
    agent: row.prov_agent ?? '',
  };
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface MemoryRow {
  id: string; name: string; definition: string; category: string;
  salience: number; confidence: number; access_count: number;
  created_at: string; updated_at: string; last_accessed: string;
  source_files: string; embedding: string; tags: string;
  fsrs_stability: number; fsrs_difficulty: number; fsrs_reps: number;
  fsrs_lapses: number; fsrs_state: string; fsrs_last_review: string | null;
  faded: number; salience_original: number | null;
  prov_model_id: string | null; prov_model_family: string | null;
  prov_client: string | null; prov_agent: string | null;
}

interface ObservationRow {
  id: string; content: string; source_file: string; source_section: string;
  salience: number; processed: number; prediction_error: number | null;
  created_at: string; updated_at: string; embedding: string | null;
  keywords: string; content_type: string | null;
  prov_model_id: string | null; prov_model_family: string | null;
  prov_client: string | null; prov_agent: string | null;
}

interface EdgeRow {
  id: string; source_id: string; target_id: string; relation: string;
  weight: number; evidence: string; created_at: string;
}

interface OpsRow {
  id: string; content: string; type: string; status: string;
  project: string | null; session_ref: string; keywords: string;
  created_at: string; updated_at: string; expires_at: string;
  prov_model_id: string | null; prov_model_family: string | null;
  prov_client: string | null; prov_agent: string | null;
}

interface BeliefRow {
  id: string; concept_id: string; old_definition: string;
  new_definition: string; reason: string; changed_at: string;
}

interface GenericRow { collection: string; id: string; data: string; }

// ─── Row converters ───────────────────────────────────────────────────────────

function rowToMemory(r: MemoryRow): Memory {
  return {
    id: r.id, name: r.name, definition: r.definition,
    category: r.category as Memory['category'],
    salience: r.salience, confidence: r.confidence,
    access_count: r.access_count,
    created_at: toDate(r.created_at), updated_at: toDate(r.updated_at),
    last_accessed: toDate(r.last_accessed),
    source_files: parseJSON<string[]>(r.source_files, []),
    embedding: parseJSON<number[]>(r.embedding, []),
    tags: parseJSON<string[]>(r.tags, []),
    fsrs: {
      stability: r.fsrs_stability, difficulty: r.fsrs_difficulty,
      reps: r.fsrs_reps, lapses: r.fsrs_lapses,
      state: r.fsrs_state as FSRSData['state'],
      last_review: toDateOrNull(r.fsrs_last_review),
    },
    faded: r.faded === 1, salience_original: r.salience_original ?? undefined,
    provenance: prov(r),
  };
}

function rowToSummary(r: MemoryRow): MemorySummary {
  return {
    id: r.id, name: r.name, definition: r.definition,
    category: r.category as Memory['category'],
    salience: r.salience, confidence: r.confidence,
    access_count: r.access_count, updated_at: toDate(r.updated_at),
    tags: parseJSON<string[]>(r.tags, []),
    fsrs: {
      stability: r.fsrs_stability, difficulty: r.fsrs_difficulty,
      reps: r.fsrs_reps, lapses: r.fsrs_lapses,
      state: r.fsrs_state as FSRSData['state'],
      last_review: toDateOrNull(r.fsrs_last_review),
    },
    provenance: prov(r),
  };
}

function rowToObservation(r: ObservationRow): Observation {
  return {
    id: r.id, content: r.content, source_file: r.source_file,
    source_section: r.source_section, salience: r.salience,
    processed: r.processed === 1, prediction_error: r.prediction_error,
    created_at: toDate(r.created_at), updated_at: toDate(r.updated_at),
    embedding: r.embedding ? parseJSON<number[]>(r.embedding, []) : null,
    keywords: parseJSON<string[]>(r.keywords, []),
    provenance: prov(r),
    content_type: (r.content_type as Observation['content_type']) ?? 'declarative',
  };
}

function rowToEdge(r: EdgeRow): Edge {
  return {
    id: r.id, source_id: r.source_id, target_id: r.target_id,
    relation: r.relation as Edge['relation'],
    weight: r.weight, evidence: r.evidence,
    created_at: toDate(r.created_at),
  };
}

function rowToOps(r: OpsRow): OpsEntry {
  return {
    id: r.id, content: r.content,
    type: r.type as OpsEntry['type'], status: r.status as OpsEntry['status'],
    project: r.project, session_ref: r.session_ref,
    keywords: parseJSON<string[]>(r.keywords, []),
    created_at: toDate(r.created_at), updated_at: toDate(r.updated_at),
    expires_at: toDate(r.expires_at),
    provenance: prov(r),
  };
}

function rowToBelief(r: BeliefRow): BeliefEntry {
  return {
    id: r.id, concept_id: r.concept_id,
    old_definition: r.old_definition, new_definition: r.new_definition,
    reason: r.reason, changed_at: toDate(r.changed_at),
  };
}

// ─── SQL Schemas ──────────────────────────────────────────────────────────────

const SCHEMAS: Record<string, string> = {
  memories: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL,
    category TEXT NOT NULL, salience REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.5, access_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_accessed TEXT NOT NULL,
    source_files TEXT NOT NULL DEFAULT '[]', embedding TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    fsrs_stability REAL NOT NULL DEFAULT 3.1262, fsrs_difficulty REAL NOT NULL DEFAULT 7.2102,
    fsrs_reps INTEGER NOT NULL DEFAULT 0, fsrs_lapses INTEGER NOT NULL DEFAULT 0,
    fsrs_state TEXT NOT NULL DEFAULT 'new', fsrs_last_review TEXT,
    faded INTEGER DEFAULT 0, salience_original REAL,
    prov_model_id TEXT, prov_model_family TEXT, prov_client TEXT, prov_agent TEXT
  )`,
  observations: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, content TEXT NOT NULL,
    source_file TEXT NOT NULL DEFAULT '', source_section TEXT NOT NULL DEFAULT '',
    salience REAL NOT NULL DEFAULT 0.5, processed INTEGER NOT NULL DEFAULT 0,
    prediction_error REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    embedding TEXT, keywords TEXT NOT NULL DEFAULT '[]',
    content_type TEXT DEFAULT 'declarative',
    prov_model_id TEXT, prov_model_family TEXT, prov_client TEXT, prov_agent TEXT
  )`,
  edges: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
    relation TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
    evidence TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  )`,
  ops: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'log', status TEXT NOT NULL DEFAULT 'active',
    project TEXT, session_ref TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    prov_model_id TEXT, prov_model_family TEXT, prov_client TEXT, prov_agent TEXT
  )`,
  signals: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, description TEXT NOT NULL,
    concept_ids TEXT NOT NULL DEFAULT '[]', priority REAL NOT NULL DEFAULT 0.5,
    resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    resolution_note TEXT
  )`,
  beliefs: `CREATE TABLE IF NOT EXISTS %T (
    id TEXT PRIMARY KEY, concept_id TEXT NOT NULL,
    old_definition TEXT NOT NULL, new_definition TEXT NOT NULL,
    reason TEXT NOT NULL, changed_at TEXT NOT NULL
  )`,
  generic_docs: `CREATE TABLE IF NOT EXISTS %T (
    collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  )`,
};

// ─── SqliteCortexStore ────────────────────────────────────────────────────────

export class SqliteCortexStore implements CortexStore {
  private db: DatabaseType;
  private ns: string;

  constructor(dbPath: string, namespace?: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ns = namespace ?? '';
    this.createTables();
  }

  private t(name: string): string {
    return this.ns ? `${this.ns}_${name}` : name;
  }

  private createTables(): void {
    for (const [name, sql] of Object.entries(SCHEMAS)) {
      this.db.exec(sql.replace('%T', this.t(name)));
    }
    this.migrateSchema();
  }

  /** Add columns introduced after initial schema. Safe to run repeatedly (no-ops on new DBs). */
  private migrateSchema(): void {
    const obsTable = this.t('observations');
    try {
      this.db.exec(`ALTER TABLE ${obsTable} ADD COLUMN content_type TEXT DEFAULT 'declarative'`);
    } catch {
      // Column already exists — expected on new DBs or after first migration
    }
  }

  // ─── Memory ────────────────────────────────────────────────────────────────

  async putMemory(memory: Omit<Memory, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('memories')} (
      id, name, definition, category, salience, confidence, access_count,
      created_at, updated_at, last_accessed, source_files, embedding, tags,
      fsrs_stability, fsrs_difficulty, fsrs_reps, fsrs_lapses, fsrs_state, fsrs_last_review,
      faded, salience_original, prov_model_id, prov_model_family, prov_client, prov_agent
    ) VALUES (
      @id, @name, @definition, @category, @salience, @confidence, @access_count,
      @created_at, @updated_at, @last_accessed, @source_files, @embedding, @tags,
      @fsrs_stability, @fsrs_difficulty, @fsrs_reps, @fsrs_lapses, @fsrs_state, @fsrs_last_review,
      @faded, @salience_original, @prov_model_id, @prov_model_family, @prov_client, @prov_agent
    )`).run({
      id, name: memory.name, definition: memory.definition,
      category: memory.category, salience: memory.salience,
      confidence: memory.confidence, access_count: memory.access_count,
      created_at: toISO(memory.created_at), updated_at: toISO(memory.updated_at),
      last_accessed: toISO(memory.last_accessed),
      source_files: JSON.stringify(memory.source_files ?? []),
      embedding: JSON.stringify(memory.embedding ?? []),
      tags: JSON.stringify(memory.tags ?? []),
      fsrs_stability: memory.fsrs.stability, fsrs_difficulty: memory.fsrs.difficulty,
      fsrs_reps: memory.fsrs.reps, fsrs_lapses: memory.fsrs.lapses,
      fsrs_state: memory.fsrs.state,
      fsrs_last_review: memory.fsrs.last_review?.toISOString() ?? null,
      faded: memory.faded ? 1 : 0, salience_original: memory.salience_original ?? null,
      prov_model_id: memory.provenance?.model_id ?? null,
      prov_model_family: memory.provenance?.model_family ?? null,
      prov_client: memory.provenance?.client ?? null,
      prov_agent: memory.provenance?.agent ?? null,
    });
    return id;
  }

  async getMemory(id: string): Promise<Memory | null> {
    const row = this.db.prepare(`SELECT * FROM ${this.t('memories')} WHERE id = ?`).get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : null;
  }

  async updateMemory(id: string, updates: Partial<Omit<Memory, 'id'>>): Promise<void> {
    const sets: string[] = [];
    const vals: Record<string, unknown> = { id };

    if (updates.name !== undefined) { sets.push('name = @name'); vals.name = updates.name; }
    if (updates.definition !== undefined) { sets.push('definition = @def'); vals.def = updates.definition; }
    if (updates.category !== undefined) { sets.push('category = @cat'); vals.cat = updates.category; }
    if (updates.salience !== undefined) { sets.push('salience = @sal'); vals.sal = updates.salience; }
    if (updates.confidence !== undefined) { sets.push('confidence = @conf'); vals.conf = updates.confidence; }
    if (updates.access_count !== undefined) { sets.push('access_count = @ac'); vals.ac = updates.access_count; }
    if (updates.updated_at !== undefined) { sets.push('updated_at = @ua'); vals.ua = updates.updated_at.toISOString(); }
    if (updates.last_accessed !== undefined) { sets.push('last_accessed = @la'); vals.la = updates.last_accessed.toISOString(); }
    if (updates.source_files !== undefined) { sets.push('source_files = @sf'); vals.sf = JSON.stringify(updates.source_files); }
    if (updates.embedding !== undefined) { sets.push('embedding = @emb'); vals.emb = JSON.stringify(updates.embedding); }
    if (updates.tags !== undefined) { sets.push('tags = @tags'); vals.tags = JSON.stringify(updates.tags); }
    if (updates.faded !== undefined) { sets.push('faded = @faded'); vals.faded = updates.faded ? 1 : 0; }
    if (updates.salience_original !== undefined) { sets.push('salience_original = @so'); vals.so = updates.salience_original; }
    if (updates.fsrs !== undefined) {
      sets.push('fsrs_stability = @fs', 'fsrs_difficulty = @fd', 'fsrs_reps = @fr',
        'fsrs_lapses = @fl', 'fsrs_state = @fst', 'fsrs_last_review = @flr');
      vals.fs = updates.fsrs.stability; vals.fd = updates.fsrs.difficulty;
      vals.fr = updates.fsrs.reps; vals.fl = updates.fsrs.lapses;
      vals.fst = updates.fsrs.state;
      vals.flr = updates.fsrs.last_review?.toISOString() ?? null;
    }
    if (updates.provenance !== undefined) {
      sets.push('prov_model_id = @pmi', 'prov_model_family = @pmf', 'prov_client = @pc', 'prov_agent = @pa');
      vals.pmi = updates.provenance.model_id; vals.pmf = updates.provenance.model_family;
      vals.pc = updates.provenance.client; vals.pa = updates.provenance.agent;
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE ${this.t('memories')} SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  }

  async findNearest(embedding: number[], limit: number): Promise<SearchResult[]> {
    const rows = this.db.prepare(
      `SELECT * FROM ${this.t('memories')} WHERE faded = 0 AND embedding != '[]'`
    ).all() as MemoryRow[];

    return rows
      .map(row => ({
        row,
        score: cosineSimilarity(embedding, parseJSON<number[]>(row.embedding, [])),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => ({
        memory: rowToSummary(row),
        score,
        distance: 1 - score,
      }));
  }

  async touchMemory(id: string, fsrsUpdates: Partial<FSRSData>): Promise<void> {
    const now = new Date().toISOString();
    const sets: string[] = ['access_count = access_count + 1', 'last_accessed = @now', 'updated_at = @now'];
    const vals: Record<string, unknown> = { id, now };

    if (fsrsUpdates.stability !== undefined) { sets.push('fsrs_stability = @fs'); vals.fs = fsrsUpdates.stability; }
    if (fsrsUpdates.difficulty !== undefined) { sets.push('fsrs_difficulty = @fd'); vals.fd = fsrsUpdates.difficulty; }
    if (fsrsUpdates.reps !== undefined) { sets.push('fsrs_reps = @fr'); vals.fr = fsrsUpdates.reps; }
    if (fsrsUpdates.lapses !== undefined) { sets.push('fsrs_lapses = @fl'); vals.fl = fsrsUpdates.lapses; }
    if (fsrsUpdates.state !== undefined) { sets.push('fsrs_state = @fst'); vals.fst = fsrsUpdates.state; }
    if (fsrsUpdates.last_review !== undefined) {
      sets.push('fsrs_last_review = @flr');
      vals.flr = fsrsUpdates.last_review?.toISOString() ?? null;
    }
    this.db.prepare(`UPDATE ${this.t('memories')} SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  }

  async getAllMemories(): Promise<Memory[]> {
    return (this.db.prepare(`SELECT * FROM ${this.t('memories')}`).all() as MemoryRow[]).map(rowToMemory);
  }

  // ─── Observation ───────────────────────────────────────────────────────────

  async putObservation(obs: Omit<Observation, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('observations')} (
      id, content, source_file, source_section, salience, processed,
      prediction_error, created_at, updated_at, embedding, keywords,
      content_type, prov_model_id, prov_model_family, prov_client, prov_agent
    ) VALUES (
      @id, @content, @sf, @ss, @sal, @proc, @pe, @ca, @ua, @emb, @kw,
      @ct, @pmi, @pmf, @pc, @pa
    )`).run({
      id, content: obs.content, sf: obs.source_file, ss: obs.source_section,
      sal: obs.salience, proc: obs.processed ? 1 : 0,
      pe: obs.prediction_error ?? null,
      ca: toISO(obs.created_at), ua: toISO(obs.updated_at),
      emb: obs.embedding ? JSON.stringify(obs.embedding) : null,
      kw: JSON.stringify(obs.keywords ?? []),
      ct: obs.content_type ?? 'declarative',
      pmi: obs.provenance?.model_id ?? null, pmf: obs.provenance?.model_family ?? null,
      pc: obs.provenance?.client ?? null, pa: obs.provenance?.agent ?? null,
    });
    return id;
  }

  async getUnprocessedObservations(limit: number): Promise<Observation[]> {
    return (this.db.prepare(
      `SELECT * FROM ${this.t('observations')} WHERE processed = 0 ORDER BY created_at ASC LIMIT ?`
    ).all(limit) as ObservationRow[]).map(rowToObservation);
  }

  async markObservationProcessed(id: string): Promise<void> {
    this.db.prepare(
      `UPDATE ${this.t('observations')} SET processed = 1, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), id);
  }

  // ─── Edge ──────────────────────────────────────────────────────────────────

  async putEdge(edge: Omit<Edge, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('edges')} (
      id, source_id, target_id, relation, weight, evidence, created_at
    ) VALUES (@id, @src, @tgt, @rel, @w, @ev, @ca)`).run({
      id, src: edge.source_id, tgt: edge.target_id, rel: edge.relation,
      w: edge.weight, ev: edge.evidence, ca: toISO(edge.created_at),
    });
    return id;
  }

  async getEdgesFrom(memoryId: string): Promise<Edge[]> {
    return (this.db.prepare(
      `SELECT * FROM ${this.t('edges')} WHERE source_id = ?`
    ).all(memoryId) as EdgeRow[]).map(rowToEdge);
  }

  async getEdgesForMemories(memoryIds: string[]): Promise<Edge[]> {
    if (memoryIds.length === 0) return [];

    // SQLite has a default variable limit of 999. Each ID appears twice
    // (source_id IN + target_id IN), so chunk at 400 to stay safe.
    const CHUNK_SIZE = 400;
    const allEdges: Edge[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < memoryIds.length; i += CHUNK_SIZE) {
      const chunk = memoryIds.slice(i, i + CHUNK_SIZE);
      const ph = chunk.map(() => '?').join(', ');
      const rows = this.db.prepare(
        `SELECT * FROM ${this.t('edges')} WHERE source_id IN (${ph}) OR target_id IN (${ph})`
      ).all(...chunk, ...chunk) as EdgeRow[];
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          allEdges.push(rowToEdge(row));
        }
      }
    }

    return allEdges;
  }

  // ─── Ops ───────────────────────────────────────────────────────────────────

  async appendOps(entry: Omit<OpsEntry, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('ops')} (
      id, content, type, status, project, session_ref, keywords,
      created_at, updated_at, expires_at,
      prov_model_id, prov_model_family, prov_client, prov_agent
    ) VALUES (
      @id, @content, @type, @status, @project, @sr, @kw,
      @ca, @ua, @ea, @pmi, @pmf, @pc, @pa
    )`).run({
      id, content: entry.content, type: entry.type, status: entry.status,
      project: entry.project ?? null, sr: entry.session_ref,
      kw: JSON.stringify(entry.keywords ?? []),
      ca: toISO(entry.created_at), ua: toISO(entry.updated_at), ea: toISO(entry.expires_at),
      pmi: entry.provenance?.model_id ?? null, pmf: entry.provenance?.model_family ?? null,
      pc: entry.provenance?.client ?? null, pa: entry.provenance?.agent ?? null,
    });
    return id;
  }

  async queryOps(filters: OpsFilters): Promise<OpsEntry[]> {
    const conds: string[] = [];
    const vals: unknown[] = [];

    if (filters.type) { conds.push('type = ?'); vals.push(filters.type); }
    if (filters.status) { conds.push('status = ?'); vals.push(filters.status); }
    if (filters.project) { conds.push('project = ?'); vals.push(filters.project); }
    if (filters.keyword) { conds.push('(content LIKE ? OR keywords LIKE ?)'); vals.push(`%${filters.keyword}%`, `%${filters.keyword}%`); }
    if (filters.days) {
      conds.push('created_at >= ?');
      vals.push(new Date(Date.now() - filters.days * 86400_000).toISOString());
    }

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = filters.limit ? `LIMIT ${filters.limit}` : '';

    return (this.db.prepare(
      `SELECT * FROM ${this.t('ops')} ${where} ORDER BY created_at DESC ${limit}`
    ).all(...vals) as OpsRow[]).map(rowToOps);
  }

  async updateOps(id: string, updates: Partial<Omit<OpsEntry, 'id'>>): Promise<void> {
    const sets: string[] = [];
    const vals: Record<string, unknown> = { id };

    if (updates.content !== undefined) { sets.push('content = @c'); vals.c = updates.content; }
    if (updates.type !== undefined) { sets.push('type = @t'); vals.t = updates.type; }
    if (updates.status !== undefined) { sets.push('status = @s'); vals.s = updates.status; }
    if (updates.project !== undefined) { sets.push('project = @p'); vals.p = updates.project; }
    if (updates.keywords !== undefined) { sets.push('keywords = @kw'); vals.kw = JSON.stringify(updates.keywords); }
    if (updates.updated_at !== undefined) { sets.push('updated_at = @ua'); vals.ua = updates.updated_at.toISOString(); }
    if (updates.expires_at !== undefined) { sets.push('expires_at = @ea'); vals.ea = updates.expires_at.toISOString(); }

    if (sets.length === 0) return;
    sets.push('updated_at = @now'); vals.now = new Date().toISOString();
    this.db.prepare(`UPDATE ${this.t('ops')} SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  }

  // ─── Signal ────────────────────────────────────────────────────────────────

  async putSignal(signal: Omit<Signal, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('signals')} (
      id, type, description, concept_ids, priority, resolved, created_at, resolution_note
    ) VALUES (@id, @type, @desc, @cids, @pri, @res, @ca, @rn)`).run({
      id, type: signal.type, desc: signal.description,
      cids: JSON.stringify(signal.concept_ids ?? []),
      pri: signal.priority, res: signal.resolved ? 1 : 0,
      ca: toISO(signal.created_at), rn: signal.resolution_note ?? null,
    });
    return id;
  }

  // ─── Belief ────────────────────────────────────────────────────────────────

  async putBelief(entry: Omit<BeliefEntry, 'id'>): Promise<string> {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO ${this.t('beliefs')} (
      id, concept_id, old_definition, new_definition, reason, changed_at
    ) VALUES (@id, @cid, @od, @nd, @r, @ca)`).run({
      id, cid: entry.concept_id, od: entry.old_definition,
      nd: entry.new_definition, r: entry.reason, ca: toISO(entry.changed_at),
    });
    return id;
  }

  async getBeliefHistory(conceptId: string): Promise<BeliefEntry[]> {
    return (this.db.prepare(
      `SELECT * FROM ${this.t('beliefs')} WHERE concept_id = ? ORDER BY changed_at ASC`
    ).all(conceptId) as BeliefRow[]).map(rowToBelief);
  }

  // ─── Generic ───────────────────────────────────────────────────────────────

  async put(collection: string, doc: Record<string, unknown>): Promise<string> {
    const id = (doc['id'] as string) ?? randomUUID();
    this.db.prepare(
      `INSERT OR REPLACE INTO ${this.t('generic_docs')} (collection, id, data) VALUES (?, ?, ?)`
    ).run(collection, id, JSON.stringify({ ...doc, id }));
    return id;
  }

  async get(collection: string, id: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare(
      `SELECT data FROM ${this.t('generic_docs')} WHERE collection = ? AND id = ?`
    ).get(collection, id) as Pick<GenericRow, 'data'> | undefined;
    return row ? JSON.parse(row.data) as Record<string, unknown> : null;
  }

  async update(collection: string, id: string, updates: Record<string, unknown>): Promise<void> {
    const txn = this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT data FROM ${this.t('generic_docs')} WHERE collection = ? AND id = ?`
      ).get(collection, id) as Pick<GenericRow, 'data'> | undefined;
      if (!row) throw new Error(`Document not found: ${collection}/${id}`);
      const existing = JSON.parse(row.data) as Record<string, unknown>;
      const merged = { ...existing, ...updates, id };
      this.db.prepare(
        `INSERT OR REPLACE INTO ${this.t('generic_docs')} (collection, id, data) VALUES (?, ?, ?)`
      ).run(collection, id, JSON.stringify(merged));
    });
    txn();
  }

  async query(
    collection: string,
    filters: QueryFilter[],
    options?: { limit?: number; orderBy?: string; orderDir?: 'asc' | 'desc' }
  ): Promise<Record<string, unknown>[]> {
    const rows = this.db.prepare(
      `SELECT data FROM ${this.t('generic_docs')} WHERE collection = ?`
    ).all(collection) as Pick<GenericRow, 'data'>[];

    let docs = rows.map(r => JSON.parse(r.data) as Record<string, unknown>);

    for (const f of filters) {
      docs = docs.filter(doc => {
        const v = doc[f.field];
        switch (f.op) {
          case '==': return v === f.value;
          case '!=': return v !== f.value;
          case '<': return typeof v === 'number' && typeof f.value === 'number' && v < f.value;
          case '<=': return typeof v === 'number' && typeof f.value === 'number' && v <= f.value;
          case '>': return typeof v === 'number' && typeof f.value === 'number' && v > f.value;
          case '>=': return typeof v === 'number' && typeof f.value === 'number' && v >= f.value;
          case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
          case 'array-contains': return Array.isArray(v) && (v as unknown[]).includes(f.value);
          default: return true;
        }
      });
    }

    if (options?.orderBy) {
      const field = options.orderBy;
      const dir = options.orderDir === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const av = a[field], bv = b[field];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -dir : dir;
      });
    }

    return options?.limit ? docs.slice(0, options.limit) : docs;
  }
}
