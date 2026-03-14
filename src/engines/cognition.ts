/**
 * Cognition engine — 7-phase dream consolidation cycle.
 *
 * Implements the full dream cycle as pure functions: storage-agnostic,
 * provider-injected. Each phase is isolated so a single phase failure
 * does not abort the whole cycle.
 *
 * Phases:
 *   1. Cluster   — route unprocessed observations to nearest memories
 *   2. Refine    — update memory definitions from new observations
 *   3. Create    — promote unclustered observations to new memories
 *   4. Connect   — discover edges between recently active memories
 *   5. Score     — FSRS passive review for memories in review/learning
 *   6. Abstract  — REM cross-domain pattern synthesis
 *   7. Report    — narrative summary of the full cycle
 */

import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import type { Memory, MemoryCategory, Observation, EdgeRelation } from '../core/types.js';
import { extractKeywords } from './keywords.js';
import { scheduleNext, newFSRSState, elapsedDaysSince } from './fsrs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DreamResult {
  phases: {
    cluster: { clustered: number; unclustered: number };
    refine: { refined: number };
    create: { created: number };
    connect: { edges_discovered: number };
    score: { scored: number };
    report: { text: string };
    abstract: { abstractions: number };
  };
  total_processed: number;
  duration_ms: number;
  /** clustered / (clustered + unclustered) */
  integration_rate: number;
}

export interface DreamOptions {
  /** Max observations to process in cluster phase (default: 50) */
  observation_limit?: number;
  /** Max unclustered to create as memories (default: 10) */
  create_limit?: number;
  /** Max abstraction attempts in REM phase (default: 5) */
  abstraction_attempts?: number;
  /** Similarity threshold for clustering (default: 0.70) */
  cluster_threshold?: number;
  /** Similarity threshold for detecting duplicate abstractions (default: 0.88) */
  abstraction_novelty_threshold?: number;
  /** Namespace config merge threshold */
  similarity_merge?: number;
  /** Namespace config link threshold */
  similarity_link?: number;
}

// ─── Internal result types ────────────────────────────────────────────────────

interface ClusterPhaseResult {
  clustered: number;
  unclustered: number;
  /** Observations that had no near-enough memory to cluster into. */
  unclusteredObs: Observation[];
}

interface RefinePhaseResult {
  refined: number;
}

interface CreatePhaseResult {
  created: number;
}

interface ConnectPhaseResult {
  edges_discovered: number;
}

interface ScorePhaseResult {
  scored: number;
}

interface AbstractPhaseResult {
  abstractions: number;
}

interface ReportPhaseResult {
  text: string;
}

// ─── Phase 1: Cluster ─────────────────────────────────────────────────────────

/**
 * Route unprocessed observations to the nearest existing memory.
 * Observations above cluster_threshold are linked and marked processed.
 * The rest are returned as unclustered for later phases.
 */
async function clusterObservations(
  store: CortexStore,
  _embed: EmbedProvider,
  options: DreamOptions,
): Promise<ClusterPhaseResult> {
  const limit = options.observation_limit ?? 50;
  const threshold = options.cluster_threshold ?? 0.70;

  let clustered = 0;
  const unclusteredObs: Observation[] = [];

  let observations: Observation[];
  try {
    observations = await store.getUnprocessedObservations(limit);
  } catch {
    return { clustered: 0, unclustered: 0, unclusteredObs: [] };
  }

  for (const obs of observations) {
    // Skip observations without embeddings — nothing to cluster on.
    if (!obs.embedding || obs.embedding.length === 0) {
      unclusteredObs.push(obs);
      continue;
    }

    try {
      const nearest = await store.findNearest(obs.embedding, 1);

      if (nearest.length > 0 && nearest[0].score >= threshold) {
        const nearestMemoryId = nearest[0].memory.id;

        // Bump the memory's access count to reflect the clustering.
        // No edge needed — the observation→memory relationship is implicit
        // in the processing, and self-referential edges are useless noise.
        await store.touchMemory(nearestMemoryId, {});

        await store.markObservationProcessed(obs.id);
        clustered++;
      } else {
        unclusteredObs.push(obs);
      }
    } catch {
      // Don't let a single observation kill the phase.
      unclusteredObs.push(obs);
    }
  }

  return {
    clustered,
    unclustered: unclusteredObs.length,
    unclusteredObs,
  };
}

// ─── Phase 2: Refine ──────────────────────────────────────────────────────────

/**
 * For memories accessed recently that have accumulated new clustered observations,
 * ask the LLM to rewrite the definition incorporating the new evidence.
 */
async function refineMemories(
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  _options: DreamOptions,
): Promise<RefinePhaseResult> {
  let refined = 0;

  let allMemories: Memory[];
  try {
    allMemories = await store.getAllMemories();
  } catch {
    return { refined: 0 };
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Find memories accessed in the last 7 days.
  const recentMemories = allMemories.filter(
    (m) => m.last_accessed.getTime() >= sevenDaysAgo,
  );

  for (const memory of recentMemories) {
    try {
      // Fetch edges with relation 'related' that reference this memory.
      const edges = await store.getEdgesFrom(memory.id);
      const relatedEdges = edges.filter((e) => e.relation === 'related');

      if (relatedEdges.length === 0) continue;

      // Use edge evidence as the observation content for refinement.
      const observationSnippets = relatedEdges
        .slice(0, 10)
        .map((e) => `- ${e.evidence}`)
        .join('\n');

      const prompt =
        `You are refining a memory concept based on new observations.\n\n` +
        `Current definition: ${memory.definition}\n\n` +
        `New observations:\n${observationSnippets}\n\n` +
        `Write an improved definition that incorporates the new observations. Keep it concise (2-4 sentences). Do not include any preamble.`;

      const newDefinition = await llm.generate(prompt, {
        temperature: 0.1,
        maxTokens: 300,
      });

      if (!newDefinition || newDefinition.trim() === memory.definition.trim()) continue;

      // Log the belief change before updating.
      await store.putBelief({
        concept_id: memory.id,
        old_definition: memory.definition,
        new_definition: newDefinition.trim(),
        reason: `Dream refinement from ${relatedEdges.length} observations`,
        changed_at: new Date(),
      });

      // Re-embed the refined definition.
      const newEmbedding = await embed.embed(newDefinition.trim());

      await store.updateMemory(memory.id, {
        definition: newDefinition.trim(),
        embedding: newEmbedding,
        updated_at: new Date(),
      });

      refined++;
    } catch {
      // One memory failing to refine should not stop the rest.
      continue;
    }
  }

  return { refined };
}

// ─── Phase 3: Create ──────────────────────────────────────────────────────────

/**
 * Promote unclustered observations to first-class memories.
 * Category is inferred by the LLM; embedding reuses the observation's.
 */
async function createFromUnclustered(
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  unclusteredObs: Observation[],
  options: DreamOptions,
): Promise<CreatePhaseResult> {
  const createLimit = options.create_limit ?? 10;
  let created = 0;

  // Only promote declarative observations to memories.
  // Interrogative (questions) and speculative (hypotheses) stay as observations —
  // they shouldn't become knowledge nodes in the memory graph.
  const declarativeObs = unclusteredObs.filter(
    obs => !obs.content_type || obs.content_type === 'declarative' || obs.content_type === 'reflective',
  );

  // Mark non-declarative observations as processed so they don't re-enter the pipeline
  const nonDeclarativeObs = unclusteredObs.filter(
    obs => obs.content_type === 'interrogative' || obs.content_type === 'speculative',
  );
  for (const obs of nonDeclarativeObs) {
    try { await store.markObservationProcessed(obs.id); } catch { /* skip */ }
  }

  const candidates = declarativeObs.slice(0, createLimit);

  for (const obs of candidates) {
    try {
      const categoryPrompt =
        `Classify this text into exactly one category: belief, pattern, entity, topic, value, project, insight, observation.\n\n` +
        `Text: ${obs.content}\n\n` +
        `Respond with only the category name, nothing else.`;

      const rawCategory = await llm.generate(categoryPrompt, {
        temperature: 0,
        maxTokens: 20,
      });

      const validCategories: MemoryCategory[] = [
        'belief', 'pattern', 'entity', 'topic', 'value', 'project', 'insight', 'observation',
      ];
      const inferred = rawCategory.trim().toLowerCase() as MemoryCategory;
      const category: MemoryCategory = validCategories.includes(inferred) ? inferred : 'observation';

      // Reuse existing embedding or generate a fresh one.
      let embedding = obs.embedding;
      if (!embedding || embedding.length === 0) {
        embedding = await embed.embed(obs.content);
      }

      const name = obs.content.length > 60
        ? obs.content.slice(0, 60)
        : obs.content;

      await store.putMemory({
        name,
        definition: obs.content,
        category,
        salience: obs.salience,
        confidence: 0.5,
        access_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        last_accessed: new Date(),
        source_files: obs.source_file ? [obs.source_file] : [],
        embedding,
        tags: obs.keywords.length > 0 ? obs.keywords : extractKeywords(obs.content),
        fsrs: newFSRSState(),
      });

      await store.markObservationProcessed(obs.id);
      created++;
    } catch {
      continue;
    }
  }

  return { created };
}

// ─── Phase 4: Connect ─────────────────────────────────────────────────────────

interface EdgeDiscoveryResponse {
  relation: EdgeRelation | null;
  evidence?: string;
}

/**
 * For recently updated memories, check each pair and create edges when
 * the LLM detects a meaningful relationship that does not yet exist.
 */
async function discoverEdges(
  store: CortexStore,
  llm: LLMProvider,
  _options: DreamOptions,
): Promise<ConnectPhaseResult> {
  let edges_discovered = 0;

  let allMemories: Memory[];
  try {
    allMemories = await store.getAllMemories();
  } catch {
    return { edges_discovered: 0 };
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const recent = allMemories
    .filter((m) => m.updated_at.getTime() >= sevenDaysAgo)
    .slice(0, 15); // cap to avoid O(n²) explosion

  if (recent.length < 2) return { edges_discovered: 0 };

  for (let i = 0; i < recent.length; i++) {
    for (let j = i + 1; j < recent.length; j++) {
      const memA = recent[i];
      const memB = recent[j];

      try {
        // Check if an edge already exists in either direction.
        const edgesFromA = await store.getEdgesFrom(memA.id);
        const alreadyConnected = edgesFromA.some(
          (e) => e.target_id === memB.id || e.source_id === memB.id,
        );
        if (alreadyConnected) continue;

        const prompt =
          `Do these two concepts have a meaningful relationship?\n\n` +
          `Concept A: ${memA.name} — ${memA.definition}\n` +
          `Concept B: ${memB.name} — ${memB.definition}\n\n` +
          `If yes, respond with JSON: {"relation": "extends|refines|contradicts|tensions-with|questions|supports|exemplifies|caused|related", "evidence": "brief explanation"}\n` +
          `If no meaningful relationship, respond with: {"relation": null}`;

        const result = await llm.generateJSON<EdgeDiscoveryResponse>(prompt, {
          temperature: 0.2,
        });

        if (result.relation !== null && result.relation !== undefined) {
          const validRelations: EdgeRelation[] = [
            'extends', 'refines', 'contradicts', 'tensions-with',
            'questions', 'supports', 'exemplifies', 'caused', 'related',
          ];
          if (!validRelations.includes(result.relation)) continue;

          await store.putEdge({
            source_id: memA.id,
            target_id: memB.id,
            relation: result.relation,
            weight: 0.7,
            evidence: result.evidence ?? '',
            created_at: new Date(),
          });

          edges_discovered++;
        }
      } catch {
        continue;
      }
    }
  }

  return { edges_discovered };
}

// ─── Phase 5: Score ───────────────────────────────────────────────────────────

/**
 * Passive FSRS review for memories currently in 'review' or 'learning' state.
 * Recent access = rating 3 (Good); otherwise rating 2 (Hard).
 */
async function scoreMemories(
  store: CortexStore,
  _options: DreamOptions,
): Promise<ScorePhaseResult> {
  let scored = 0;

  let allMemories: Memory[];
  try {
    allMemories = await store.getAllMemories();
  } catch {
    return { scored: 0 };
  }

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  const reviewable = allMemories.filter(
    (m) => m.fsrs.state === 'review' || m.fsrs.state === 'learning',
  );

  for (const memory of reviewable) {
    try {
      const elapsed = elapsedDaysSince(memory.fsrs.last_review);
      const recentlyAccessed = memory.last_accessed.getTime() >= threeDaysAgo;
      const rating: 2 | 3 = recentlyAccessed ? 3 : 2;

      const scheduled = scheduleNext(memory.fsrs, rating, elapsed);

      await store.touchMemory(memory.id, {
        stability: scheduled.stability,
        difficulty: scheduled.difficulty,
        reps: memory.fsrs.reps + 1,
        lapses: memory.fsrs.lapses,
        state: scheduled.state,
        last_review: new Date(),
      });

      scored++;
    } catch {
      continue;
    }
  }

  return { scored };
}

// ─── Phase 6: Abstract (REM) ──────────────────────────────────────────────────

/**
 * REM sleep phase: sample recent memories across categories and attempt
 * to synthesize higher-level cross-domain abstractions.
 */
async function abstractCrossDomain(
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  options: DreamOptions,
): Promise<AbstractPhaseResult> {
  const attempts = options.abstraction_attempts ?? 5;
  const noveltyThreshold = options.abstraction_novelty_threshold ?? 0.88;
  let abstractions = 0;

  let allMemories: Memory[];
  try {
    allMemories = await store.getAllMemories();
  } catch {
    return { abstractions: 0 };
  }

  // Work from 60 most recently updated memories.
  const recent = allMemories
    .sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
    .slice(0, 60);

  // Group by category.
  const byCategory = new Map<MemoryCategory, Memory[]>();
  for (const m of recent) {
    const group = byCategory.get(m.category) ?? [];
    group.push(m);
    byCategory.set(m.category, group);
  }

  const categories = Array.from(byCategory.keys());
  if (categories.length < 3) return { abstractions: 0 };

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // Pick 4 different random categories (or as many as available, min 3).
      const shuffled = categories.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(4, shuffled.length));

      // Pick one random memory from each selected category.
      const sampledMemories = selected.map((cat) => {
        const group = byCategory.get(cat)!;
        return group[Math.floor(Math.random() * group.length)];
      });

      const conceptLines = sampledMemories
        .map((m) => `[${m.category}] ${m.name}: ${m.definition}`)
        .join('\n\n');

      const prompt =
        `Find a higher-level principle or pattern that connects these diverse concepts:\n\n` +
        `${conceptLines}\n\n` +
        `Write a concise abstraction (1-2 sentences) that captures the deeper connection. ` +
        `If no meaningful connection exists, respond with 'NO_ABSTRACTION'.`;

      const result = await llm.generate(prompt, {
        temperature: 0.4,
        maxTokens: 200,
      });

      const trimmed = result.trim();
      if (!trimmed || trimmed === 'NO_ABSTRACTION') continue;

      // Check novelty — don't store abstractions too similar to existing memories.
      const abstEmbedding = await embed.embed(trimmed);
      const nearest = await store.findNearest(abstEmbedding, 1);

      if (nearest.length > 0 && nearest[0].score >= noveltyThreshold) {
        // Too similar to an existing memory — skip.
        continue;
      }

      await store.putMemory({
        name: trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed,
        definition: trimmed,
        category: 'insight',
        salience: 0.8,
        confidence: 0.6,
        access_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
        last_accessed: new Date(),
        source_files: [],
        embedding: abstEmbedding,
        tags: extractKeywords(trimmed),
        fsrs: newFSRSState(),
      });

      abstractions++;
    } catch {
      continue;
    }
  }

  return { abstractions };
}

// ─── Phase 7: Report ──────────────────────────────────────────────────────────

/**
 * Generate a human-readable narrative of what the dream cycle accomplished.
 * Called last so it can include abstraction count.
 */
async function generateReport(
  llm: LLMProvider,
  cluster: ClusterPhaseResult,
  refine: RefinePhaseResult,
  create: CreatePhaseResult,
  connect: ConnectPhaseResult,
  score: ScorePhaseResult,
  abstract: AbstractPhaseResult,
): Promise<ReportPhaseResult> {
  try {
    const prompt =
      `Summarize this dream consolidation session in 2-3 sentences.\n\n` +
      `Stats: ${cluster.clustered} observations clustered, ${refine.refined} memories refined, ` +
      `${create.created} new memories created, ${connect.edges_discovered} edges discovered, ` +
      `${score.scored} memories reviewed, ${abstract.abstractions} abstractions formed.\n\n` +
      `Write a brief, reflective summary of what was learned and consolidated.`;

    const text = await llm.generate(prompt, {
      temperature: 0.7,
      maxTokens: 200,
    });

    return { text: text.trim() };
  } catch {
    const fallback =
      `Dream cycle complete. ` +
      `Clustered ${cluster.clustered} observations, refined ${refine.refined} memories, ` +
      `created ${create.created} new memories, discovered ${connect.edges_discovered} edges, ` +
      `reviewed ${score.scored} memories, formed ${abstract.abstractions} abstractions.`;
    return { text: fallback };
  }
}

// ─── Main: dreamConsolidate ───────────────────────────────────────────────────

/**
 * Run the full 7-phase dream consolidation cycle.
 *
 * Phase ordering:
 *   1 Cluster → 2 Refine → 3 Create → 4 Connect → 5 Score → 6 Abstract → 7 Report
 *
 * Report runs last so it can include abstraction stats.
 * A phase error is caught internally — the cycle continues with degraded output.
 */
export async function dreamConsolidate(
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  options: DreamOptions = {},
): Promise<DreamResult> {
  const start = Date.now();

  // Phase 1 — Cluster
  const clusterResult = await clusterObservations(store, embed, options);

  // Phase 2 — Refine
  const refineResult = await refineMemories(store, embed, llm, options);

  // Phase 3 — Create
  const createResult = await createFromUnclustered(
    store,
    embed,
    llm,
    clusterResult.unclusteredObs,
    options,
  );

  // Phase 4 — Connect
  const connectResult = await discoverEdges(store, llm, options);

  // Phase 5 — Score
  const scoreResult = await scoreMemories(store, options);

  // Phase 6 — Abstract (REM)
  const abstractResult = await abstractCrossDomain(store, embed, llm, options);

  // Phase 7 — Report (runs after abstract to include abstraction count)
  const reportResult = await generateReport(
    llm,
    clusterResult,
    refineResult,
    createResult,
    connectResult,
    scoreResult,
    abstractResult,
  );

  const duration_ms = Date.now() - start;
  const total = clusterResult.clustered + clusterResult.unclustered;
  const integration_rate = total > 0 ? clusterResult.clustered / total : 0;

  return {
    phases: {
      cluster: { clustered: clusterResult.clustered, unclustered: clusterResult.unclustered },
      refine: { refined: refineResult.refined },
      create: { created: createResult.created },
      connect: { edges_discovered: connectResult.edges_discovered },
      score: { scored: scoreResult.scored },
      report: { text: reportResult.text },
      abstract: { abstractions: abstractResult.abstractions },
    },
    total_processed: clusterResult.clustered + createResult.created,
    duration_ms,
    integration_rate,
  };
}
