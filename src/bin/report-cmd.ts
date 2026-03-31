/**
 * report-cmd.ts — fozikio report command.
 *
 * Generates a weekly quality report across five layers:
 *   1. Memory health — salience distribution, staleness, FSRS states
 *   2. Observation health — unprocessed count, prediction error coverage
 *   3. Retrieval quality — retry rate, intent distribution (via threads)
 *   4. Cognitive integration — edge density, observation prediction errors
 *   5. Session quality — ops volume, open threads, resolved threads
 *
 * Usage:
 *   fozikio report
 *   fozikio report --days 14
 *   fozikio report --json
 */

import { loadConfig } from './config-loader.js';
import { createStore } from './store-factory.js';
import type { Memory, Observation, OpsEntry, Edge } from '../core/types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALE_DAYS = 90;
const WIDTH = 58;

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

interface ReportArgs {
  days: number;
  jsonOutput: boolean;
}

function parseArgs(args: string[]): ReportArgs {
  let days = 7;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      jsonOutput = true;
    } else if (args[i] === '--days' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed > 0) days = parsed;
    }
  }

  return { days, jsonOutput };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  const content = `  ${label.padEnd(32)}${value}`;
  return `║${content.padEnd(WIDTH)}║`;
}

function subrow(label: string, value: string): string {
  const content = `    ${label.padEnd(30)}${value}`;
  return `║${content.padEnd(WIDTH)}║`;
}

function header(title: string): string {
  const padded = ` ${title} `;
  const totalPad = WIDTH - padded.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `║${' '.repeat(left)}${padded}${' '.repeat(right)}║`;
}

function divider(): string { return `╠${'═'.repeat(WIDTH)}╣`; }
function topBorder(): string { return `╔${'═'.repeat(WIDTH)}╗`; }
function bottomBorder(): string { return `╚${'═'.repeat(WIDTH)}╝`; }

function fmt(n: number, digits = 3): string { return n.toFixed(digits); }

function pct(count: number, total: number): string {
  if (total === 0) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function statusIcon(
  value: number,
  thresholds: { good: number; warn: number; direction: 'lower' | 'higher' },
): string {
  const { good, warn, direction } = thresholds;
  if (direction === 'lower') {
    if (value <= good) return '[OK]';
    if (value <= warn) return '[!] ';
    return '[!!]';
  } else {
    if (value >= good) return '[OK]';
    if (value >= warn) return '[!] ';
    return '[!!]';
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function runReport(args: string[]): Promise<void> {
  const { days, jsonOutput } = parseArgs(args);

  const config = loadConfig();
  const store = await createStore(config);

  const now = new Date();
  const windowCutoff = new Date(now);
  windowCutoff.setDate(windowCutoff.getDate() - days);
  const staleCutoff = new Date(now);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_DAYS);

  if (!jsonOutput) {
    process.stderr.write(`[report] Collecting data (last ${days} days)...\n`);
  }

  // ── Parallel data fetch ─────────────────────────────────────────────────
  const [memories, allObs, weekOps, allThreads] = await Promise.all([
    store.getAllMemories(),
    // Fetch all observations (no date filter on store.query since we filter in-memory)
    store.query('observations', [], { limit: 10000 }).then(
      docs => docs as unknown as Observation[],
    ),
    store.queryOps({ days, limit: 5000 }),
    store.query('threads', [], { limit: 2000 }).then(
      docs => docs as unknown as Array<{ status?: string; resolved_at?: Date | string | null }>,
    ),
  ]);

  // Fetch edges for all memory IDs
  const memoryIds = memories.map(m => m.id);
  const allEdges: Edge[] = memoryIds.length > 0
    ? await store.getEdgesForMemories(memoryIds)
    : [];

  // ── Layer 1: Memory Health ───────────────────────────────────────────────
  const totalMemories = memories.length;
  const lowSalience = memories.filter((m: Memory) => (m.salience ?? 0) < 0.1).length;
  const fadedMemories = memories.filter((m: Memory) => m.faded === true).length;
  const staleMemories = memories.filter((m: Memory) => {
    const la = m.last_accessed;
    return la instanceof Date && la < staleCutoff;
  }).length;
  const avgSalience = totalMemories > 0
    ? memories.reduce((s: number, m: Memory) => s + (m.salience ?? 0), 0) / totalMemories
    : 0;

  const fsrsCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  for (const m of memories) {
    const state = m.fsrs?.state;
    if (state && state in fsrsCounts) fsrsCounts[state as keyof typeof fsrsCounts]++;
  }

  const categoryCounts: Record<string, number> = {};
  for (const m of memories) {
    const cat = m.category ?? 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
  }

  // ── Layer 2: Observation Health ──────────────────────────────────────────
  const totalObs = allObs.length;
  const unprocessedObs = allObs.filter((o: Observation) => !o.processed).length;
  const obsWithPE = allObs.filter((o: Observation) => o.prediction_error != null);
  const avgPE = obsWithPE.length > 0
    ? obsWithPE.reduce((s: number, o: Observation) => s + (o.prediction_error ?? 0), 0) / obsWithPE.length
    : 0;
  const peCoverage = totalObs > 0 ? obsWithPE.length / totalObs : 0;

  // ── Layer 3: Edge / Graph Health ─────────────────────────────────────────
  const totalEdges = allEdges.length;
  const edgeDensity = totalMemories > 1
    ? totalEdges / (totalMemories * (totalMemories - 1) / 2)
    : 0;

  const relationCounts: Record<string, number> = {};
  for (const e of allEdges) {
    const rel = e.relation ?? 'unknown';
    relationCounts[rel] = (relationCounts[rel] ?? 0) + 1;
  }

  // Memories with no outgoing edges (isolated nodes)
  const connectedMemoryIds = new Set<string>();
  for (const e of allEdges) {
    connectedMemoryIds.add(e.source_id);
    connectedMemoryIds.add(e.target_id);
  }
  const isolatedMemories = totalMemories - connectedMemoryIds.size;

  // ── Layer 4: Ops / Session Quality ───────────────────────────────────────
  const weekOpsEntries = weekOps as OpsEntry[];
  const uniqueSessions = new Set(
    weekOpsEntries.map((o: OpsEntry) => o.session_ref).filter(Boolean),
  ).size;

  // Flag entries: unknown intent signals (ops entries containing 'unknown' or 'error')
  const flaggedOps = weekOpsEntries.filter((o: OpsEntry) =>
    o.content.toLowerCase().includes('error') ||
    o.content.toLowerCase().includes('failed'),
  ).length;

  const projectCounts: Record<string, number> = {};
  for (const o of weekOpsEntries) {
    const proj = o.project ?? 'none';
    projectCounts[proj] = (projectCounts[proj] ?? 0) + 1;
  }

  // ── Layer 5: Thread Quality ───────────────────────────────────────────────
  const openThreads = allThreads.filter(
    (t) => t.status !== 'resolved',
  ).length;

  const resolvedThisWindow = allThreads.filter((t) => {
    if (t.status !== 'resolved') return false;
    const ra = t.resolved_at;
    if (!ra) return false;
    const d = ra instanceof Date ? ra : new Date(String(ra));
    return d >= windowCutoff;
  }).length;

  // ── Flags / Issues ───────────────────────────────────────────────────────
  const issues: string[] = [];
  if (lowSalience / Math.max(totalMemories, 1) > 0.3) {
    issues.push(`High low-salience rate: ${pct(lowSalience, totalMemories)} of memories below 0.1`);
  }
  if (staleMemories / Math.max(totalMemories, 1) > 0.4) {
    issues.push(`High staleness: ${pct(staleMemories, totalMemories)} of memories unaccessed in ${STALE_DAYS}d`);
  }
  if (unprocessedObs / Math.max(totalObs, 1) > 0.2) {
    issues.push(`Observation backlog: ${unprocessedObs} unprocessed observations (${pct(unprocessedObs, totalObs)})`);
  }
  if (peCoverage < 0.3 && totalObs > 50) {
    issues.push(`Low PE coverage: only ${pct(obsWithPE.length, totalObs)} of observations have prediction_error scored`);
  }
  if (isolatedMemories / Math.max(totalMemories, 1) > 0.5) {
    issues.push(`Graph sparsity: ${pct(isolatedMemories, totalMemories)} of memories have no edges`);
  }
  if (flaggedOps > 0) {
    issues.push(`${flaggedOps} ops entries contain error/failed signals this window`);
  }

  // ── Build Report Object ─────────────────────────────────────────────────
  const report = {
    generated_at: now.toISOString(),
    window_days: days,
    layer1_memory: {
      total: totalMemories,
      avg_salience: avgSalience,
      low_salience: lowSalience,
      stale: staleMemories,
      faded: fadedMemories,
      fsrs: fsrsCounts,
      categories: categoryCounts,
    },
    layer2_observations: {
      total: totalObs,
      unprocessed: unprocessedObs,
      avg_prediction_error: avgPE,
      pe_coverage: peCoverage,
    },
    layer3_graph: {
      total_edges: totalEdges,
      edge_density: edgeDensity,
      isolated_memories: isolatedMemories,
      relations: relationCounts,
    },
    layer4_ops: {
      entries_this_window: weekOpsEntries.length,
      unique_sessions: uniqueSessions,
      flagged_entries: flaggedOps,
      projects: projectCounts,
    },
    layer5_threads: {
      open_threads: openThreads,
      resolved_this_window: resolvedThisWindow,
    },
    issues,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // ── Render Dashboard ────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(topBorder());
  lines.push(header('CORTEX QUALITY REPORT'));
  lines.push(header(`${days}-day window  |  ${now.toISOString().slice(0, 10)}`));

  // Layer 1
  lines.push(divider());
  lines.push(header('Layer 1: Memory Health'));
  lines.push(divider());
  lines.push(row('Total memories:', totalMemories.toLocaleString()));
  lines.push(row('Avg salience:', fmt(avgSalience)));
  lines.push(row('Low salience (<0.1):', `${lowSalience} (${pct(lowSalience, totalMemories)}) ${statusIcon(lowSalience / Math.max(totalMemories, 1), { good: 0.1, warn: 0.3, direction: 'lower' })}`));
  lines.push(row(`Stale (>${STALE_DAYS}d):`, `${staleMemories} (${pct(staleMemories, totalMemories)}) ${statusIcon(staleMemories / Math.max(totalMemories, 1), { good: 0.2, warn: 0.4, direction: 'lower' })}`));
  lines.push(row('Faded:', fadedMemories.toLocaleString()));
  lines.push(row('FSRS:', `new=${fsrsCounts.new} learn=${fsrsCounts.learning} rev=${fsrsCounts.review} relearn=${fsrsCounts.relearning}`));
  const topCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [cat, count] of topCats) {
    lines.push(subrow(`${cat}:`, `${count} (${pct(count, totalMemories)})`));
  }

  // Layer 2
  lines.push(divider());
  lines.push(header('Layer 2: Observation Health'));
  lines.push(divider());
  lines.push(row('Total observations:', totalObs.toLocaleString()));
  lines.push(row('Unprocessed:', `${unprocessedObs} ${statusIcon(unprocessedObs / Math.max(totalObs, 1), { good: 0.05, warn: 0.2, direction: 'lower' })}`));
  lines.push(row('Avg prediction error:', fmt(avgPE)));
  lines.push(row('PE coverage:', `${pct(obsWithPE.length, totalObs)} ${statusIcon(peCoverage, { good: 0.5, warn: 0.3, direction: 'higher' })}`));

  // Layer 3
  lines.push(divider());
  lines.push(header('Layer 3: Graph / Edge Health'));
  lines.push(divider());
  lines.push(row('Total edges:', totalEdges.toLocaleString()));
  lines.push(row('Edge density:', fmt(edgeDensity, 4)));
  lines.push(row('Isolated memories:', `${isolatedMemories} (${pct(isolatedMemories, totalMemories)}) ${statusIcon(isolatedMemories / Math.max(totalMemories, 1), { good: 0.3, warn: 0.5, direction: 'lower' })}`));
  const topRels = Object.entries(relationCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [rel, count] of topRels) {
    lines.push(subrow(`${rel}:`, count.toLocaleString()));
  }

  // Layer 4
  lines.push(divider());
  lines.push(header(`Layer 4: Ops / Sessions (last ${days}d)`));
  lines.push(divider());
  lines.push(row('Ops entries:', weekOpsEntries.length.toLocaleString()));
  lines.push(row('Unique sessions:', uniqueSessions.toLocaleString()));
  lines.push(row('Flagged (error/failed):', `${flaggedOps} ${statusIcon(flaggedOps, { good: 0, warn: 3, direction: 'lower' })}`));
  const topProjects = Object.entries(projectCounts)
    .filter(([k]) => k !== 'none')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  for (const [proj, count] of topProjects) {
    lines.push(subrow(`${proj}:`, count.toLocaleString()));
  }

  // Layer 5
  lines.push(divider());
  lines.push(header('Layer 5: Thread Quality'));
  lines.push(divider());
  lines.push(row('Open threads:', openThreads.toLocaleString()));
  lines.push(row('Resolved this window:', resolvedThisWindow.toLocaleString()));

  // Issues
  if (issues.length > 0) {
    lines.push(divider());
    lines.push(header('Issues Flagged'));
    lines.push(divider());
    for (const issue of issues) {
      // Wrap long issue text
      const truncated = issue.length > WIDTH - 4 ? issue.slice(0, WIDTH - 7) + '...' : issue;
      lines.push(row('!', truncated));
    }
  }

  lines.push(bottomBorder());

  console.log('');
  for (const line of lines) console.log(line);
  console.log('');
}
