/**
 * Digest engine — document ingestion pipeline for cortex.
 *
 * Takes raw document content (markdown with optional YAML frontmatter) and
 * runs it through a configurable pipeline of cognitive steps. Each step is
 * isolated in a try/catch so a single failure does not abort the pipeline.
 *
 * Pipeline steps:
 *   observe  — embed and store content as observations (with prediction error gating)
 *   reflect  — generate LLM insights connecting content to existing memories
 *   predict  — extract forward-looking claims and store as prediction observations
 *   extract  — LLM-categorize content into typed observations (beliefs, questions,
 *              hypotheses, reflections) using the existing content_type system
 */

import { parse as parseYaml } from 'yaml';
import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import { predictionErrorGate } from './memory.js';
import { extractKeywords } from './keywords.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DigestOptions {
  /** Pipeline of cognitive steps. Default: ['observe', 'reflect'] */
  pipeline?: string[];
  /** Target namespace (default: 'default') */
  namespace?: string;
  /** Source file path for provenance */
  source_file?: string;
  /** Salience override (default: auto-detect from content) */
  salience?: number;
}

export interface DigestResult {
  /** IDs of observations created */
  observation_ids: string[];
  /** Memories that were linked or created */
  memories_linked: string[];
  /** Insights generated during reflect step */
  insights: string[];
  /** Pipeline steps that ran */
  pipeline_executed: string[];
  /** Timestamp of processing */
  processed_at: Date;
  /** Duration in ms */
  duration_ms: number;
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Split YAML frontmatter from markdown body.
 * Returns empty frontmatter and the full string if no frontmatter is found.
 */
function parseDocument(content: string): ParsedDocument {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endMarker = trimmed.indexOf('\n---', 3);
  if (endMarker === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(3, endMarker).trim();
  const body = trimmed.slice(endMarker + 4).trimStart();

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlBlock);
    if (parsed && typeof parsed === 'object') {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter — continue without it.
  }

  return { frontmatter, body };
}

// ─── Salience Detection ───────────────────────────────────────────────────────

/**
 * Estimate salience from document structure and metadata.
 * Returns a value on the 1–10 scale used by observe.
 */
function detectSalience(
  frontmatter: Record<string, unknown>,
  body: string,
): number {
  // Frontmatter can override directly.
  if (typeof frontmatter['salience'] === 'number') {
    return Math.min(10, Math.max(1, frontmatter['salience'] as number));
  }

  // Status hints.
  const status = typeof frontmatter['status'] === 'string'
    ? (frontmatter['status'] as string).toLowerCase()
    : '';
  if (status === 'active') return 7;
  if (status === 'archived') return 3;

  // Type hints.
  const type = typeof frontmatter['type'] === 'string'
    ? (frontmatter['type'] as string).toLowerCase()
    : '';
  if (type === 'mind' || type === 'journal') return 7;
  if (type === 'knowledge') return 6;

  // Fall back to content length heuristic.
  if (body.length > 3000) return 7;
  if (body.length > 1000) return 6;
  return 5;
}

// ─── Observe Step ─────────────────────────────────────────────────────────────

interface ObserveStepResult {
  observation_ids: string[];
  memories_linked: string[];
}

async function runObserveStep(
  body: string,
  frontmatter: Record<string, unknown>,
  store: CortexStore,
  embed: EmbedProvider,
  sourceFile: string,
  salience: number,
): Promise<ObserveStepResult> {
  const observation_ids: string[] = [];
  const memories_linked: string[] = [];

  const title = typeof frontmatter['title'] === 'string'
    ? (frontmatter['title'] as string)
    : '';

  if (body.length > 2000) {
    // Long document: summarise first, then observe chunks.
    // Summary chunk at full salience.
    await (async () => {
      try {
        const summaryText = title ? `${title}\n\n${body.slice(0, 2000)}` : body.slice(0, 2000);
        const embedding = await embed.embed(summaryText);
        const gate = await predictionErrorGate(store, embedding);
        const keywords = extractKeywords(summaryText);

        const id = await store.putObservation({
          content: summaryText,
          source_file: sourceFile,
          source_section: 'summary',
          salience,
          processed: false,
          prediction_error: gate.max_similarity > 0 ? 1 - gate.max_similarity : null,
          created_at: new Date(),
          updated_at: new Date(),
          embedding,
          keywords,
        });

        observation_ids.push(id);
        if (gate.decision === 'link' && gate.nearest_id) {
          memories_linked.push(gate.nearest_id);
        }
      } catch {
        // Single chunk failure — continue.
      }
    })();

    // Remaining body in ~500 char chunks at reduced salience.
    const chunkSalience = Math.max(1, salience - 2);
    const chunks: string[] = [];
    for (let i = 2000; i < body.length; i += 500) {
      chunks.push(body.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      try {
        const embedding = await embed.embed(chunk);
        const gate = await predictionErrorGate(store, embedding);
        const keywords = extractKeywords(chunk);

        const id = await store.putObservation({
          content: chunk,
          source_file: sourceFile,
          source_section: 'chunk',
          salience: chunkSalience,
          processed: false,
          prediction_error: gate.max_similarity > 0 ? 1 - gate.max_similarity : null,
          created_at: new Date(),
          updated_at: new Date(),
          embedding,
          keywords,
        });

        observation_ids.push(id);
        if (gate.decision === 'link' && gate.nearest_id) {
          memories_linked.push(gate.nearest_id);
        }
      } catch {
        // Single chunk failure — continue.
      }
    }
  } else {
    // Short document: observe whole body.
    try {
      const observeText = title ? `${title}\n\n${body}` : body;
      const embedding = await embed.embed(observeText);
      const gate = await predictionErrorGate(store, embedding);
      const keywords = extractKeywords(observeText);

      const id = await store.putObservation({
        content: observeText,
        source_file: sourceFile,
        source_section: '',
        salience,
        processed: false,
        prediction_error: gate.max_similarity > 0 ? 1 - gate.max_similarity : null,
        created_at: new Date(),
        updated_at: new Date(),
        embedding,
        keywords,
      });

      observation_ids.push(id);
      if (gate.decision === 'link' && gate.nearest_id) {
        memories_linked.push(gate.nearest_id);
      }
    } catch {
      // Observe step failed — return empty.
    }
  }

  return { observation_ids, memories_linked };
}

// ─── Reflect Step ─────────────────────────────────────────────────────────────

async function runReflectStep(
  body: string,
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  sourceFile: string,
  salience: number,
): Promise<string[]> {
  const insights: string[] = [];

  try {
    // Find memories related to this content.
    const contentEmbedding = await embed.embed(body.slice(0, 1000));
    const related = await store.findNearest(contentEmbedding, 5);

    const memoryContext = related
      .map(r => `- ${r.memory.name}: ${r.memory.definition}`)
      .join('\n');

    const snippet = body.length > 800 ? body.slice(0, 800) + '...' : body;

    const prompt =
      `You are reflecting on new document content and connecting it to existing knowledge.\n\n` +
      `Document content:\n${snippet}\n\n` +
      `Related memories:\n${memoryContext || '(no related memories found)'}\n\n` +
      `Generate 2-3 concise insights that connect this content to the existing memories, ` +
      `or identify novel patterns and implications. Each insight on its own line. ` +
      `No preamble, no numbering — just the insights.`;

    const reflectionText = await llm.generate(prompt, {
      temperature: 0.6,
      maxTokens: 400,
    });

    const insightLines = reflectionText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 20);

    for (const insight of insightLines) {
      try {
        const embedding = await embed.embed(insight);
        const keywords = extractKeywords(`digest reflect ${insight}`);

        await store.putObservation({
          content: insight,
          source_file: sourceFile,
          source_section: 'digest:reflect',
          salience: Math.max(1, salience - 1),
          processed: false,
          prediction_error: null,
          created_at: new Date(),
          updated_at: new Date(),
          embedding,
          keywords,
        });

        insights.push(insight);
      } catch {
        // One insight failing to store should not stop the rest.
      }
    }
  } catch {
    // Reflect step failed — return whatever insights accumulated.
  }

  return insights;
}

// ─── Predict Step ─────────────────────────────────────────────────────────────

async function runPredictStep(
  body: string,
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  sourceFile: string,
  salience: number,
): Promise<string[]> {
  const extractedPredictions: string[] = [];

  try {
    const snippet = body.length > 1000 ? body.slice(0, 1000) + '...' : body;

    const prompt =
      `Extract forward-looking claims or predictions from this text. ` +
      `Only include explicit predictions, goals, plans, or hypotheses about future events. ` +
      `If there are no forward-looking claims, respond with: NO_PREDICTIONS\n\n` +
      `Text:\n${snippet}\n\n` +
      `List each prediction on its own line. No preamble, no numbering.`;

    const result = await llm.generate(prompt, {
      temperature: 0.1,
      maxTokens: 300,
    });

    const trimmed = result.trim();
    if (trimmed === 'NO_PREDICTIONS' || !trimmed) {
      return extractedPredictions;
    }

    const predictions = trimmed
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 15 && l !== 'NO_PREDICTIONS');

    for (const prediction of predictions) {
      try {
        const embedding = await embed.embed(prediction);
        const keywords = extractKeywords(`prediction ${prediction}`);

        await store.putObservation({
          content: prediction,
          source_file: sourceFile,
          source_section: 'digest:predict',
          salience: Math.max(1, salience - 1),
          processed: false,
          prediction_error: null,
          created_at: new Date(),
          updated_at: new Date(),
          embedding,
          keywords,
        });

        extractedPredictions.push(prediction);
      } catch {
        // One prediction failing should not stop the rest.
      }
    }
  } catch {
    // Predict step failed — return whatever accumulated.
  }

  return extractedPredictions;
}

// ─── Extract Step ────────────────────────────────────────────────────────────

interface ExtractedItem {
  text: string;
  type: 'belief' | 'question' | 'hypothesis' | 'reflection' | 'fact';
  salience: number;
}

const CONTENT_TYPE_MAP: Record<ExtractedItem['type'], string> = {
  belief: 'declarative',
  question: 'interrogative',
  hypothesis: 'speculative',
  reflection: 'reflective',
  fact: 'declarative',
};

async function runExtractStep(
  body: string,
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  sourceFile: string,
  salience: number,
): Promise<ObserveStepResult> {
  const observation_ids: string[] = [];
  const memories_linked: string[] = [];

  const snippet = body.length > 3000 ? body.slice(0, 3000) + '...' : body;

  const prompt =
    `Extract structured knowledge from this text. Categorize each item:\n\n` +
    `- belief: a position held, value, preference, opinion, or aesthetic choice\n` +
    `- question: an open question, curiosity, or unresolved wonder\n` +
    `- hypothesis: an untested idea, speculation, or "what if"\n` +
    `- reflection: a synthesized insight, emotional response, or pattern noticed\n` +
    `- fact: a concrete, verified piece of information\n\n` +
    `Return a JSON array. Each item: { "text": "...", "type": "belief|question|hypothesis|reflection|fact", "salience": 0.3-0.9 }\n` +
    `Higher salience for strongly held beliefs, recurring patterns, and emotional reactions.\n` +
    `Only include items with real substance — skip filler and operational noise.\n` +
    `If nothing worth extracting, return [].\n\n` +
    `Text:\n${snippet}`;

  try {
    const items = await llm.generateJSON<ExtractedItem[]>(prompt, {
      temperature: 0.2,
      maxTokens: 1024,
    });

    if (!Array.isArray(items)) return { observation_ids, memories_linked };

    for (const item of items.slice(0, 10)) {
      if (!item.text || item.text.length < 10) continue;

      try {
        const embedding = await embed.embed(item.text);
        const gate = await predictionErrorGate(store, embedding);
        const keywords = extractKeywords(item.text);
        const contentType = CONTENT_TYPE_MAP[item.type] ?? 'declarative';
        const itemSalience = typeof item.salience === 'number'
          ? Math.min(0.9, Math.max(0.3, item.salience))
          : salience / 10;

        if (gate.decision === 'merge') continue; // Already known — skip

        const id = await store.putObservation({
          content: item.text,
          source_file: sourceFile,
          source_section: `digest:extract:${item.type}`,
          salience: itemSalience,
          processed: false,
          prediction_error: gate.max_similarity > 0 ? 1 - gate.max_similarity : null,
          created_at: new Date(),
          updated_at: new Date(),
          embedding,
          keywords,
          content_type: contentType as 'declarative' | 'interrogative' | 'speculative' | 'reflective',
        });

        observation_ids.push(id);
        if (gate.decision === 'link' && gate.nearest_id) {
          memories_linked.push(gate.nearest_id);
        }
      } catch {
        // Single item failure — continue with rest
      }
    }
  } catch {
    // LLM extraction failed — return whatever accumulated
  }

  return { observation_ids, memories_linked };
}

// ─── Main: digestDocument ─────────────────────────────────────────────────────

/**
 * Process a document through the cortex ingestion pipeline.
 *
 * Parses frontmatter, detects salience, then runs each requested pipeline step
 * in sequence. Steps are isolated — a single step failure does not abort the
 * pipeline; it is logged as skipped.
 *
 * Supported steps: 'observe', 'reflect', 'predict'
 * Unknown steps are silently skipped and recorded in pipeline_executed as
 * 'skipped:<name>'.
 */
export async function digestDocument(
  content: string,
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
  options?: DigestOptions,
): Promise<DigestResult> {
  const start = Date.now();

  const pipeline = options?.pipeline ?? ['observe', 'reflect'];
  const sourceFile = options?.source_file ?? '';
  const { frontmatter, body } = parseDocument(content);
  const salience = options?.salience ?? detectSalience(frontmatter, body);

  const observation_ids: string[] = [];
  const memories_linked: string[] = [];
  const insights: string[] = [];
  const pipeline_executed: string[] = [];

  for (const step of pipeline) {
    switch (step) {
      case 'observe': {
        try {
          const result = await runObserveStep(
            body,
            frontmatter,
            store,
            embed,
            sourceFile,
            salience,
          );
          observation_ids.push(...result.observation_ids);
          memories_linked.push(...result.memories_linked);
          pipeline_executed.push('observe');
        } catch {
          pipeline_executed.push('observe:failed');
        }
        break;
      }

      case 'reflect': {
        try {
          const stepInsights = await runReflectStep(
            body,
            store,
            embed,
            llm,
            sourceFile,
            salience,
          );
          insights.push(...stepInsights);
          pipeline_executed.push('reflect');
        } catch {
          pipeline_executed.push('reflect:failed');
        }
        break;
      }

      case 'predict': {
        try {
          const predictions = await runPredictStep(
            body,
            store,
            embed,
            llm,
            sourceFile,
            salience,
          );
          insights.push(...predictions);
          pipeline_executed.push('predict');
        } catch {
          pipeline_executed.push('predict:failed');
        }
        break;
      }

      case 'extract': {
        try {
          const result = await runExtractStep(
            body,
            store,
            embed,
            llm,
            sourceFile,
            salience,
          );
          observation_ids.push(...result.observation_ids);
          memories_linked.push(...result.memories_linked);
          pipeline_executed.push('extract');
        } catch {
          pipeline_executed.push('extract:failed');
        }
        break;
      }

      default: {
        pipeline_executed.push(`skipped:${step}`);
        break;
      }
    }
  }

  return {
    observation_ids,
    memories_linked: [...new Set(memories_linked)],
    insights,
    pipeline_executed,
    processed_at: new Date(),
    duration_ms: Date.now() - start,
  };
}
