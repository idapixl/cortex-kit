/**
 * vitals-cmd.ts — fozikio vitals command handler.
 *
 * Computes behavioral vitals (frustration, confidence, curiosity,
 * creative_energy, connection) from CortexStore data, then computes
 * PE delta (prediction error with vs without retrieval).
 *
 * Works with both SQLite and Firestore backends.
 *
 * Usage:
 *   fozikio vitals
 *   fozikio vitals --days 14
 *   fozikio vitals --json
 */

import { loadConfig } from './config-loader.js';
import { SqliteCortexStore } from '../stores/sqlite.js';
import { FirestoreCortexStore } from '../stores/firestore.js';
import type { CortexStore } from '../core/store.js';
import type { CortexConfig } from '../core/config.js';
import type {
  Observation,
  Edge,
  OpsEntry,
  QueryFilter,
} from '../core/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 30;
const WIDTH = 52;

// ─── Types ────────────────────────────────────────────────────────────────────

type VitalDimension =
  | 'frustration'
  | 'confidence'
  | 'curiosity'
  | 'creative_energy'
  | 'connection';

interface RetrievalTrace {
  session_id?: string;
  query_text?: string;
  tool_used?: string;
  retry_within_60s?: boolean;
  detected_intent?: string;
  timestamp?: Date | string | null;
  [key: string]: unknown;
}

interface ThreadDoc {
  updates?: unknown[];
  updated_at?: Date | string | null;
  [key: string]: unknown;
}

interface VitalRecord {
  dimension?: string;
  value?: number;
  [key: string]: unknown;
}

interface BehavioralVital {
  dimension: VitalDimension;
  behavioral: number;
  self_reported: number | null;
  divergence: number | null;
}

interface PEOverall {
  with_retrieval: { count: number; avg_pe: number };
  without_retrieval: { count: number; avg_pe: number };
  delta: number;
  interpretation: string;
}

interface PerIntentEntry {
  count: number;
  avg_pe_with_retrieval: number;
  avg_pe_without_retrieval: number;
  delta: number;
}

interface VitalsReport {
  generated_at: string;
  window_days: number;
  vitals: BehavioralVital[];
  data_sources: {
    traces: number;
    ops: number;
    observations: number;
    edges: number;
    threads: number;
  };
  pe_delta: {
    overall: PEOverall;
    per_intent: Record<string, PerIntentEntry>;
    disclaimer: string;
  };
}

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

interface ParsedArgs {
  json: boolean;
  days: number;
}

function parseArgs(args: string[]): ParsedArgs {
  let json = false;
  let days = DEFAULT_DAYS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--days' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed > 0) days = parsed;
    }
  }

  return { json, days };
}

// ─── Store Factory ────────────────────────────────────────────────────────────

async function createStore(config: CortexConfig): Promise<CortexStore> {
  if (config.store === 'firestore') {
    const { getApps, initializeApp } = await import('firebase-admin/app');
    if (getApps().length === 0) {
      initializeApp({ projectId: config.store_options?.gcp_project_id });
    }
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    const db = config.store_options?.firestore_database_id
      ? getFirestore(config.store_options.firestore_database_id)
      : getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    return new FirestoreCortexStore(db, '', FieldValue);
  }

  return new SqliteCortexStore(
    config.store_options?.sqlite_path ?? './cortex.db',
  );
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return t.toDate();
  if (typeof v === 'string') return new Date(v);
  return null;
}

// ─── Box Drawing ─────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  const content = `  ${label.padEnd(28)}${value}`;
  return `\u2551${content.padEnd(WIDTH)}\u2551`;
}

function header(title: string): string {
  const padded = ` ${title} `;
  const totalPad = WIDTH - padded.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `\u2551${' '.repeat(left)}${padded}${' '.repeat(right)}\u2551`;
}

function divider(): string { return `\u2560${'\u2550'.repeat(WIDTH)}\u2563`; }
function top(): string     { return `\u2554${'\u2550'.repeat(WIDTH)}\u2557`; }
function bottom(): string  { return `\u255a${'\u2550'.repeat(WIDTH)}\u255d`; }
function fmt(n: number, digits = 3): string { return n.toFixed(digits); }
function clamp(n: number): number { return Math.max(0, Math.min(1, n)); }

// ─── Jaccard Similarity ───────────────────────────────────────────────────────

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\W+/).filter(w => w.length > 2));
  const setB = new Set(b.split(/\W+/).filter(w => w.length > 2));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ─── Vitals Computation ───────────────────────────────────────────────────────

/**
 * Frustration: retry_rate * 0.6 + reformulation_rate * 0.4
 */
function computeFrustration(traces: RetrievalTrace[]): number {
  if (traces.length === 0) return 0;

  const retried = traces.filter(t => t.retry_within_60s === true).length;
  const retryRate = retried / traces.length;

  const bySession = new Map<string, RetrievalTrace[]>();
  for (const t of traces) {
    const sid = (t.session_id as string | undefined) ?? 'unknown';
    const list = bySession.get(sid) ?? [];
    list.push(t);
    bySession.set(sid, list);
  }

  let reformulationCount = 0;
  let consecutivePairs = 0;

  for (const sessionTraces of bySession.values()) {
    const sorted = [...sessionTraces].sort((a, b) => {
      const da = toDate(a.timestamp)?.getTime() ?? 0;
      const db_ = toDate(b.timestamp)?.getTime() ?? 0;
      return da - db_;
    });

    for (let i = 1; i < sorted.length; i++) {
      consecutivePairs++;
      const prev = (sorted[i - 1].query_text as string | undefined)?.toLowerCase() ?? '';
      const curr = (sorted[i].query_text as string | undefined)?.toLowerCase() ?? '';
      if (jaccardSimilarity(prev, curr) > 0.5) {
        reformulationCount++;
      }
    }
  }

  const reformulationRate = consecutivePairs > 0 ? reformulationCount / consecutivePairs : 0;
  return clamp(retryRate * 0.6 + reformulationRate * 0.4);
}

const HEDGING_PATTERNS = [
  /\bmight\b/i, /\bmaybe\b/i, /\bperhaps\b/i, /\bpossibly\b/i,
  /\bnot sure\b/i, /\bi think\b/i, /\bcould be\b/i, /\bprobably\b/i,
  /\bunclear\b/i, /\buncertain\b/i, /\bseems like\b/i, /\bnot certain\b/i,
];

const ASSERTIVE_PATTERNS = [
  /\bclearly\b/i, /\bdefinitely\b/i, /\bobviously\b/i, /\bi know\b/i,
  /\bconfirmed\b/i, /\bproven\b/i, /\bwithout doubt\b/i, /\bcertainly\b/i,
];

/**
 * Confidence: assertion_ratio * 0.3 + hedging_signal * 0.7
 */
function computeConfidence(observations: Observation[]): number {
  if (observations.length === 0) return 0.5;

  let hedgingCount = 0;
  let assertiveCount = 0;
  let totalSentences = 0;
  let questions = 0;

  for (const obs of observations) {
    const text = obs.content ?? '';
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    totalSentences += sentences.length;
    questions += (text.match(/\?/g) ?? []).length;

    for (const s of sentences) {
      if (HEDGING_PATTERNS.some(p => p.test(s))) hedgingCount++;
      if (ASSERTIVE_PATTERNS.some(p => p.test(s))) assertiveCount++;
    }
  }

  const assertionRatio = totalSentences > 0
    ? Math.max(0, totalSentences - questions) / totalSentences
    : 0.5;

  const taggedTotal = hedgingCount + assertiveCount;
  const hedgingSignal = taggedTotal > 0
    ? 1 - (hedgingCount / taggedTotal)
    : 0.5;

  return clamp(assertionRatio * 0.3 + hedgingSignal * 0.7);
}

/**
 * Curiosity: topic_diversity * 0.4 + wander_rate * 0.3 + novelty_seeking * 0.3
 */
function computeCuriosity(traces: RetrievalTrace[]): number {
  if (traces.length === 0) return 0;

  const wanderCount = traces.filter(t => t.tool_used === 'wander').length;
  const wanderRate = wanderCount / traces.length;

  const topicSet = new Set<string>();
  for (const t of traces) {
    const words = ((t.query_text as string | undefined) ?? '')
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2);
    if (words.length >= 2) {
      topicSet.add(`${words[0]}_${words[1]}`);
    } else if (words.length === 1) {
      topicSet.add(words[0]);
    }
  }
  const topicDiversity = clamp(topicSet.size / 20);

  const nonOperational = traces.filter(t =>
    t.detected_intent &&
    t.detected_intent !== 'operational' &&
    t.detected_intent !== 'ambiguous'
  ).length;
  const noveltySeeking = nonOperational / traces.length;

  return clamp(topicDiversity * 0.4 + wanderRate * 0.3 + noveltySeeking * 0.3);
}

/**
 * Creative energy: novel_edges / max(observations, 1)
 */
function computeCreativeEnergy(observations: Observation[], edges: Edge[], windowStart: Date): number {
  if (observations.length === 0) return 0;

  const novelEdges = edges.filter(e => {
    const created = e.created_at instanceof Date ? e.created_at : toDate(e.created_at);
    return created && created >= windowStart;
  }).length;

  return clamp(novelEdges / Math.max(observations.length, 1));
}

/**
 * Connection: thread_updates / max(ops_entries, 1)
 */
function computeConnection(threads: ThreadDoc[], opsEntries: OpsEntry[]): number {
  if (opsEntries.length === 0) return 0;

  const totalUpdates = threads.reduce(
    (sum, t) => sum + (Array.isArray(t.updates) ? t.updates.length : 0),
    0,
  );

  return clamp(totalUpdates / Math.max(opsEntries.length, 1));
}

// ─── PE Delta Computation ─────────────────────────────────────────────────────

function computePEDelta(
  observations: Observation[],
  traces: RetrievalTrace[],
): { overall: PEOverall; per_intent: Record<string, PerIntentEntry> } {
  const retrievalSessionIds = new Set<string>();
  const intentBySession = new Map<string, Set<string>>();
  const retrievalHourBuckets = new Set<string>();

  for (const t of traces) {
    const sid = t.session_id as string | undefined;
    if (sid) {
      retrievalSessionIds.add(sid);
      const intent = t.detected_intent as string | undefined;
      if (intent) {
        if (!intentBySession.has(sid)) intentBySession.set(sid, new Set());
        intentBySession.get(sid)!.add(intent);
      }
    }
    const ts = toDate(t.timestamp);
    if (ts) {
      retrievalHourBuckets.add(ts.toISOString().slice(0, 13));
    }
  }

  const withRetrieval: number[] = [];
  const withoutRetrieval: number[] = [];
  const intentPEWith = new Map<string, number[]>();
  const intentPEWithout = new Map<string, number[]>();

  for (const obs of observations) {
    if (obs.prediction_error == null) continue;

    const obsCreated = obs.created_at instanceof Date ? obs.created_at : toDate(obs.created_at);
    const inRetrievalSession =
      retrievalSessionIds.size > 0 ||
      (obsCreated && retrievalHourBuckets.has(obsCreated.toISOString().slice(0, 13)));

    if (inRetrievalSession) {
      withRetrieval.push(obs.prediction_error);
    } else {
      withoutRetrieval.push(obs.prediction_error);
    }
  }

  const avg = (arr: number[]): number =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  const avgWith = avg(withRetrieval);
  const avgWithout = avg(withoutRetrieval);
  const delta = avgWith - avgWithout;

  const allIntents = new Set([...intentPEWith.keys(), ...intentPEWithout.keys()]);
  const perIntent: Record<string, PerIntentEntry> = {};
  for (const intent of allIntents) {
    const withArr = intentPEWith.get(intent) ?? [];
    const withoutArr = intentPEWithout.get(intent) ?? [];
    perIntent[intent] = {
      count: withArr.length + withoutArr.length,
      avg_pe_with_retrieval: avg(withArr),
      avg_pe_without_retrieval: avg(withoutArr),
      delta: avg(withArr) - avg(withoutArr),
    };
  }

  const interpretation = delta < 0
    ? 'negative delta — retrieval correlates with lower PE (good)'
    : delta > 0
      ? 'positive delta — retrieval correlates with higher PE (investigate)'
      : 'no difference';

  return {
    overall: {
      with_retrieval: { count: withRetrieval.length, avg_pe: avgWith },
      without_retrieval: { count: withoutRetrieval.length, avg_pe: avgWithout },
      delta,
      interpretation,
    },
    per_intent: perIntent,
  };
}

// ─── Report Rendering ─────────────────────────────────────────────────────────

function renderReport(report: VitalsReport): void {
  const { vitals, data_sources, pe_delta, window_days } = report;
  const now = new Date(report.generated_at);

  const lines: string[] = [];
  lines.push(top());
  lines.push(header('BEHAVIORAL VITALS REPORT'));
  lines.push(header(now.toISOString().slice(0, 10)));
  lines.push(header(`Window: last ${window_days} days`));
  lines.push(divider());

  // Column header
  {
    const content = `  ${'Dimension'.padEnd(18)}${'Behavioral'.padEnd(12)}${'Self-Report'.padEnd(13)}Div`;
    lines.push(`\u2551${content.padEnd(WIDTH)}\u2551`);
  }
  lines.push(divider());

  for (const v of vitals) {
    const bStr = fmt(v.behavioral);
    const srStr = v.self_reported !== null ? fmt(v.self_reported) : ' \u2014 ';
    const divStr = v.divergence !== null ? fmt(v.divergence) : ' \u2014 ';
    const content = `  ${v.dimension.padEnd(18)}${bStr.padEnd(12)}${srStr.padEnd(13)}${divStr}`;
    lines.push(`\u2551${content.padEnd(WIDTH)}\u2551`);
  }

  lines.push(divider());
  lines.push(header('Data Sources'));
  lines.push(divider());
  lines.push(row('Retrieval traces:', String(data_sources.traces)));
  lines.push(row('Ops entries:', String(data_sources.ops)));
  lines.push(row('Observations:', String(data_sources.observations)));
  lines.push(row('Edges:', String(data_sources.edges)));
  lines.push(row('Threads:', String(data_sources.threads)));

  lines.push(divider());
  lines.push(header('PREDICTION ERROR DELTA'));
  lines.push(divider());

  const { overall } = pe_delta;
  if (overall.with_retrieval.count + overall.without_retrieval.count === 0) {
    lines.push(row('PE delta:', 'no prediction_error data'));
  } else {
    const deltaStr = (overall.delta < 0 ? '' : '+') + fmt(overall.delta);
    lines.push(row('With retrieval:', `${fmt(overall.with_retrieval.avg_pe)} (n=${overall.with_retrieval.count})`));
    lines.push(row('Without retrieval:', `${fmt(overall.without_retrieval.avg_pe)} (n=${overall.without_retrieval.count})`));
    lines.push(row('Delta:', deltaStr));
    // Wrap interpretation
    const interp = overall.interpretation;
    lines.push(row('Interpretation:', interp.length > 22 ? interp.slice(0, 22) + '...' : interp));
  }

  lines.push(bottom());

  console.log('');
  for (const line of lines) console.log(line);
  console.log('');
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function runVitals(args: string[]): Promise<void> {
  const { json, days } = parseArgs(args);

  const config = loadConfig();
  const store = await createStore(config);

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - days);

  process.stderr.write(`[fozikio vitals] Loading data (last ${days} days)...\n`);

  const cutoffFilter: QueryFilter = { field: 'created_at', op: '>=', value: windowStart };

  // Load all required data in parallel
  const [opsEntries, rawTraces, rawObservations, rawEdges, rawThreads, rawVitals] =
    await Promise.all([
      store.queryOps({ days }),
      store.query('retrieval_traces', [{ field: 'timestamp', op: '>=', value: windowStart }], { limit: 1000, orderBy: 'timestamp', orderDir: 'desc' }),
      store.query('observations', [cutoffFilter], { limit: 500 }),
      store.query('edges', [cutoffFilter], { limit: 1000 }),
      store.query('threads', [{ field: 'updated_at', op: '>=', value: windowStart }]),
      store.query('vitals', []),
    ]);

  // Cast to typed arrays
  const traces = rawTraces as RetrievalTrace[];
  const observations = rawObservations as unknown as Observation[];
  const edges = rawEdges as unknown as Edge[];
  const threads = rawThreads as ThreadDoc[];

  process.stderr.write(
    `[fozikio vitals] Loaded: ${traces.length} traces, ${opsEntries.length} ops, ` +
    `${observations.length} obs, ${edges.length} edges, ${threads.length} threads\n`,
  );

  // Build self-reported vitals map
  const selfReportedMap = new Map<VitalDimension, number>();
  for (const v of rawVitals) {
    const vital = v as VitalRecord;
    const dim = (vital.dimension ?? '') as VitalDimension;
    if (dim && typeof vital.value === 'number') {
      selfReportedMap.set(dim, vital.value);
    }
  }

  // Compute behavioral vitals
  const dimensions: VitalDimension[] = [
    'frustration',
    'confidence',
    'curiosity',
    'creative_energy',
    'connection',
  ];

  const behavioralValues: Record<VitalDimension, number> = {
    frustration: computeFrustration(traces),
    confidence: computeConfidence(observations),
    curiosity: computeCuriosity(traces),
    creative_energy: computeCreativeEnergy(observations, edges, windowStart),
    connection: computeConnection(threads, opsEntries),
  };

  const vitals: BehavioralVital[] = dimensions.map(dim => {
    const behavioral = behavioralValues[dim];
    const self_reported = selfReportedMap.get(dim) ?? null;
    const divergence = self_reported !== null ? Math.abs(behavioral - self_reported) : null;
    return { dimension: dim, behavioral, self_reported, divergence };
  });

  // Compute PE delta
  const { overall, per_intent } = computePEDelta(observations, traces);

  const report: VitalsReport = {
    generated_at: now.toISOString(),
    window_days: days,
    vitals,
    data_sources: {
      traces: traces.length,
      ops: opsEntries.length,
      observations: observations.length,
      edges: edges.length,
      threads: threads.length,
    },
    pe_delta: {
      overall,
      per_intent,
      disclaimer:
        'OBSERVATIONAL metric only. Sessions are not randomly assigned. ' +
        'A negative delta is consistent with retrieval helping, but does not prove causation.',
    },
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderReport(report);
  }
}
