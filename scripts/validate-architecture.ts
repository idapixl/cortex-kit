/**
 * validate-architecture.ts — End-to-end proof that cortex-engine works
 * locally with Ollama + SQLite. No cloud credentials needed.
 *
 * Exercises:
 *   1. SqliteCortexStore — CRUD for memories, observations, edges, ops
 *   2. OllamaEmbedProvider — embedding text via qwen3-embedding
 *   3. OllamaLLMProvider — text generation via qwen2.5
 *   4. predictionErrorGate — similarity-based ingestion routing
 *   5. hydeExpand — HyDE query expansion (LLM + embed)
 *   6. spreadActivation — graph-based memory retrieval
 *   7. extractKeywords — keyword extraction
 *
 * Prerequisites:
 *   - Ollama running on localhost:11434
 *   - Models pulled: qwen3-embedding:0.6b, qwen2.5:14b (or qwen2.5:7b)
 *
 * Usage:
 *   npx tsx scripts/validate-architecture.ts
 *   npx tsx scripts/validate-architecture.ts --llm-model qwen2.5:7b
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { SqliteCortexStore } from '../src/stores/sqlite.js';
import { OllamaEmbedProvider } from '../src/providers/ollama.js';
import { OllamaLLMProvider } from '../src/providers/ollama.js';
import {
  predictionErrorGate,
  hydeExpand,
  spreadActivation,
  memoryToSummary,
} from '../src/engines/memory.js';
import { extractKeywords } from '../src/engines/keywords.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'qwen3-embedding:0.6b';
const LLM_MODEL = process.argv.includes('--llm-model')
  ? process.argv[process.argv.indexOf('--llm-model') + 1]
  : (process.env.LLM_MODEL ?? 'qwen2.5:14b');

const DB_PATH = join(tmpdir(), `cortex-validate-${randomUUID()}.db`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function section(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n── ${name} ──`);
  try {
    await fn();
  } catch (err) {
    console.error(`  ✗ SECTION FAILED: ${err}`);
    failed++;
  }
}

// ─── Preflight ───────────────────────────────────────────────────────────────

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return false;
    const data = await res.json() as { models: Array<{ name: string }> };
    const names = data.models.map((m: { name: string }) => m.name);
    console.log(`Ollama models: ${names.join(', ')}`);

    const hasEmbed = names.some(n => n.startsWith(EMBED_MODEL.split(':')[0]));
    const hasLLM = names.some(n => n.startsWith(LLM_MODEL.split(':')[0]));

    if (!hasEmbed) console.warn(`  ⚠ Embed model "${EMBED_MODEL}" not found`);
    if (!hasLLM) console.warn(`  ⚠ LLM model "${LLM_MODEL}" not found`);

    return hasEmbed && hasLLM;
  } catch {
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('cortex-engine architecture validation');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
  console.log(`Embed: ${EMBED_MODEL}  LLM: ${LLM_MODEL}\n`);

  // Preflight
  const ollamaReady = await checkOllama();
  if (!ollamaReady) {
    console.error('\nOllama not ready. Ensure Ollama is running with required models.');
    process.exit(1);
  }

  // Wire up providers
  const store = new SqliteCortexStore(DB_PATH);
  const embed = new OllamaEmbedProvider({ model: EMBED_MODEL, baseUrl: OLLAMA_URL });
  const llm = new OllamaLLMProvider({ model: LLM_MODEL, baseUrl: OLLAMA_URL });

  // ── 1. Store CRUD ──────────────────────────────────────────────────────────

  await section('Store: Memory CRUD', async () => {
    const embedding = await embed.embed('TypeScript is a typed superset of JavaScript');
    assert(embedding.length === embed.dimensions, `Embedding dimensions: ${embedding.length}`);

    const id = await store.putMemory({
      name: 'TypeScript',
      definition: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
      category: 'concept',
      salience: 0.7,
      confidence: 0.8,
      access_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
      last_accessed: new Date(),
      source_files: ['test'],
      embedding,
      tags: ['language', 'web'],
      fsrs: { stability: 3.13, difficulty: 7.21, reps: 0, lapses: 0, state: 'new', last_review: null },
      faded: false,
    });
    assert(typeof id === 'string' && id.length > 0, `Memory created: ${id.slice(0, 8)}...`);

    const mem = await store.getMemory(id);
    assert(mem !== null && mem.name === 'TypeScript', 'Memory retrieved');
    assert(mem!.embedding.length === embed.dimensions, 'Embedding persisted');

    await store.updateMemory(id, { salience: 0.9 });
    const updated = await store.getMemory(id);
    assert(updated?.salience === 0.9, 'Memory updated');

    await store.touchMemory(id, { reps: 1, state: 'learning' });
    const touched = await store.getMemory(id);
    assert(touched?.access_count === 1 && touched?.fsrs.state === 'learning', 'Memory touched with FSRS');
  });

  await section('Store: Observations', async () => {
    const obsId = await store.putObservation({
      content: 'Noticed that Rust borrow checker prevents data races at compile time',
      source_file: 'validate-architecture.ts',
      source_section: 'test',
      salience: 0.6,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding: null,
      keywords: ['rust', 'borrow-checker', 'safety'],
    });
    assert(typeof obsId === 'string', `Observation created: ${obsId.slice(0, 8)}...`);

    const unprocessed = await store.getUnprocessedObservations(10);
    assert(unprocessed.length >= 1, `Unprocessed observations: ${unprocessed.length}`);

    await store.markObservationProcessed(obsId);
    const after = await store.getUnprocessedObservations(10);
    assert(after.length === 0, 'Observation marked processed');
  });

  await section('Store: Edges', async () => {
    const mems = await store.getAllMemories();
    const memId = mems[0].id;

    // Create a second memory for edge
    const embedding2 = await embed.embed('JavaScript runs in the browser and on Node.js');
    const id2 = await store.putMemory({
      name: 'JavaScript',
      definition: 'JavaScript is the language of the web, running in browsers and via Node.js.',
      category: 'concept',
      salience: 0.6,
      confidence: 0.7,
      access_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
      last_accessed: new Date(),
      source_files: ['test'],
      embedding: embedding2,
      tags: ['language', 'web'],
      fsrs: { stability: 3.13, difficulty: 7.21, reps: 0, lapses: 0, state: 'new', last_review: null },
      faded: false,
    });

    const edgeId = await store.putEdge({
      source_id: memId,
      target_id: id2,
      relation: 'related_to',
      weight: 0.9,
      evidence: 'TypeScript compiles to JavaScript',
      created_at: new Date(),
    });
    assert(typeof edgeId === 'string', `Edge created: ${edgeId.slice(0, 8)}...`);

    const edges = await store.getEdgesFrom(memId);
    assert(edges.length === 1 && edges[0].target_id === id2, 'Edge retrieved');
  });

  await section('Store: Ops Log', async () => {
    const opsId = await store.appendOps({
      content: 'validate-architecture: running e2e test',
      type: 'log',
      status: 'active',
      project: 'cortex-engine',
      session_ref: 'validate',
      keywords: ['test', 'validation'],
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 86400_000),
    });
    assert(typeof opsId === 'string', `Ops entry created: ${opsId.slice(0, 8)}...`);

    const ops = await store.queryOps({ project: 'cortex-engine', limit: 5 });
    assert(ops.length >= 1, `Ops query returned: ${ops.length} entries`);
  });

  // ── 2. Embedding Provider ──────────────────────────────────────────────────

  await section('Embed: Single + Batch', async () => {
    const single = await embed.embed('cognitive architecture for AI agents');
    assert(single.length === embed.dimensions, `Single embed: ${single.length}d`);

    const batch = await embed.embedBatch([
      'memory consolidation during sleep',
      'spreading activation in semantic networks',
      'prediction error minimization',
    ]);
    assert(batch.length === 3, `Batch embed: ${batch.length} vectors`);
    assert(batch.every(v => v.length === embed.dimensions), 'All batch vectors correct dimension');
  });

  // ── 3. LLM Provider ───────────────────────────────────────────────────────

  await section('LLM: Generate + GenerateJSON', async () => {
    const text = await llm.generate(
      'In one sentence, what is spreading activation in cognitive science?',
      { temperature: 0.1, maxTokens: 100 },
    );
    assert(text.length > 10, `Generate: "${text.slice(0, 80)}..."`);

    const json = await llm.generateJSON<{ keywords: string[] }>(
      'Extract 3 keywords from: "Memory consolidation happens during sleep through hippocampal replay"',
      {
        temperature: 0,
        maxTokens: 100,
        schema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' } } } },
      },
    );
    assert(
      Array.isArray(json.keywords) && json.keywords.length > 0,
      `GenerateJSON: ${JSON.stringify(json.keywords)}`,
    );
  });

  // ── 4. Memory Engine Functions ─────────────────────────────────────────────

  await section('Engine: predictionErrorGate', async () => {
    // Embed something very similar to existing "TypeScript" memory
    const similar = await embed.embed('TypeScript adds static types to JavaScript');
    const gate1 = await predictionErrorGate(store, similar);
    assert(
      gate1.decision === 'merge' || gate1.decision === 'link',
      `Similar content → ${gate1.decision} (similarity: ${gate1.max_similarity.toFixed(3)})`,
    );

    // Embed something totally different
    const novel = await embed.embed('Photosynthesis converts sunlight into chemical energy');
    const gate2 = await predictionErrorGate(store, novel);
    assert(
      gate2.decision === 'novel' || gate2.max_similarity < 0.5,
      `Novel content → ${gate2.decision} (similarity: ${gate2.max_similarity.toFixed(3)})`,
    );
  });

  await section('Engine: hydeExpand', async () => {
    const expanded = await hydeExpand('How does memory consolidation work?', llm, embed);
    assert(expanded.length === embed.dimensions, `HyDE embedding: ${expanded.length}d`);

    // Should give better results than raw query embedding
    const raw = await embed.embed('How does memory consolidation work?');
    assert(
      raw.length === expanded.length,
      'Raw vs HyDE embeddings same dimension',
    );
  });

  await section('Engine: spreadActivation', async () => {
    const mems = await store.getAllMemories();
    assert(mems.length >= 2, `${mems.length} memories in store`);

    // Start from the TypeScript memory
    const ts = mems.find(m => m.name === 'TypeScript');
    assert(ts !== undefined, 'Found TypeScript memory');

    if (ts) {
      // spreadActivation takes SearchResult[], not string[]
      const seedResults = [{ memory: memoryToSummary(ts), score: 1.0, distance: 0 }];
      const activated = await spreadActivation(store, seedResults, undefined, 2);
      assert(activated.length >= 1, `Activated ${activated.length} memories`);

      // JavaScript should be activated via the edge
      const jsActivated = activated.find(a => a.memory.name === 'JavaScript');
      assert(jsActivated !== undefined, 'JavaScript reached via spreading activation');
    }
  });

  await section('Engine: extractKeywords', async () => {
    const kw = extractKeywords('Memory consolidation during sleep involves hippocampal replay');
    assert(kw.length > 0, `Keywords: ${kw.join(', ')}`);
    assert(kw.some(k => k.includes('memory') || k.includes('consolidation') || k.includes('hippocampal')),
      'Contains relevant keywords');
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}`);

  // Cleanup
  try {
    if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
    if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal');
    if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm');
    console.log('Temp DB cleaned up.');
  } catch { /* ignore cleanup errors */ }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
