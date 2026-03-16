/**
 * Core types for cortex-engine.
 *
 * These are storage-agnostic — no Firestore imports, no Timestamp.
 * Stores convert between these and their native types.
 */

// ─── Memory ───────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'belief'
  | 'pattern'
  | 'entity'
  | 'topic'
  | 'value'
  | 'project'
  | 'insight'
  | 'observation'
  | 'goal';

export type FSRSState = 'new' | 'learning' | 'review' | 'relearning';

export interface FSRSData {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: FSRSState;
  last_review: Date | null;
}

export interface Memory {
  id: string;
  name: string;
  definition: string;
  category: MemoryCategory;
  salience: number;
  confidence: number;
  access_count: number;
  created_at: Date;
  updated_at: Date;
  last_accessed: Date;
  source_files: string[];
  embedding: number[];
  tags: string[];
  fsrs: FSRSData;
  faded?: boolean;
  salience_original?: number;
  provenance?: ModelProvenance;
  /** Last retrieval cosine similarity score (0-1). Set by touchMemory. */
  last_retrieval_score?: number;
  /** Last retrieval hop count (0 = direct match). Set by touchMemory. */
  last_hop_count?: number;
  /** Memory origin for differentiated FSRS initialization. */
  memory_origin?: 'organic' | 'dream' | 'abstract';
}

export interface MemorySummary {
  id: string;
  name: string;
  definition: string;
  category: MemoryCategory;
  salience: number;
  confidence: number;
  access_count: number;
  updated_at: Date;
  tags: string[];
  fsrs: FSRSData;
  provenance?: ModelProvenance;
}

// ─── Edge ─────────────────────────────────────────────────────────────────────

export type EdgeRelation =
  | 'extends'
  | 'refines'
  | 'contradicts'
  | 'tensions-with'
  | 'questions'
  | 'supports'
  | 'exemplifies'
  | 'caused'
  | 'related';

export interface Edge {
  id: string;
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight: number;
  evidence: string;
  created_at: Date;
}

// ─── Observation ──────────────────────────────────────────────────────────────

export type ObservationContentType = 'declarative' | 'interrogative' | 'speculative' | 'reflective';

export interface Observation {
  id: string;
  content: string;
  source_file: string;
  source_section: string;
  salience: number;
  processed: boolean;
  prediction_error: number | null;
  created_at: Date;
  updated_at: Date;
  embedding: number[] | null;
  keywords: string[];
  provenance?: ModelProvenance;
  /** Content type for filtering — declarative (facts), interrogative (questions), speculative (hypotheses), reflective (synthesis). Defaults to 'declarative'. */
  content_type?: ObservationContentType;
}

// ─── Ops ──────────────────────────────────────────────────────────────────────

export type OpsEntryType = 'log' | 'instruction' | 'handoff' | 'milestone' | 'decision';
export type OpsStatus = 'active' | 'done' | 'stale';

export interface OpsEntry {
  id: string;
  content: string;
  type: OpsEntryType;
  status: OpsStatus;
  project: string | null;
  session_ref: string;
  keywords: string[];
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  provenance?: ModelProvenance;
}

export interface OpsFilters {
  type?: OpsEntryType;
  status?: OpsStatus;
  project?: string;
  keyword?: string;
  days?: number;
  limit?: number;
}

// ─── Signal ───────────────────────────────────────────────────────────────────

export type SignalType = 'CONTRADICTION' | 'TENSION' | 'GAP' | 'REDUNDANCY' | 'SURPRISE';

export interface Signal {
  id: string;
  type: SignalType;
  description: string;
  concept_ids: string[];
  priority: number;
  resolved: boolean;
  created_at: Date;
  resolution_note: string | null;
}

// ─── Belief ───────────────────────────────────────────────────────────────────

export interface BeliefEntry {
  id: string;
  concept_id: string;
  old_definition: string;
  new_definition: string;
  reason: string;
  changed_at: Date;
}

// ─── Search Results ───────────────────────────────────────────────────────────

export interface SearchResult {
  memory: MemorySummary;
  score: number;
  distance: number;
}

export interface ActivationResult extends SearchResult {
  hop_count: number;
  activation_path: string[];
}

export type IngestDecision = 'merge' | 'link' | 'novel';

export interface GateResult {
  decision: IngestDecision;
  nearest_id?: string;
  max_similarity: number;
}

export interface ScheduleResult {
  stability: number;
  difficulty: number;
  interval_days: number;
  state: FSRSState;
}

// ─── Model Provenance ─────────────────────────────────────────────────────────

export interface ModelProvenance {
  model_id: string;
  model_family: string;
  client: string;
  agent: string;
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

// ─── Generic Query ────────────────────────────────────────────────────────────

export interface QueryFilter {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
  value: unknown;
}
