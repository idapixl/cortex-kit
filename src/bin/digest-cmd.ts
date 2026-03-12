/**
 * digest-cmd.ts — cortex-kit digest command handler.
 *
 * Usage:
 *   cortex-kit digest <file>                                Process a single file
 *   cortex-kit digest --pending                            Process files with directive: digest
 *   cortex-kit digest --dry-run                            Show what would be processed
 *   cortex-kit digest --pipeline observe,reflect,predict   Custom pipeline
 *   cortex-kit digest --namespace prediction               Target namespace
 *   cortex-kit digest --dir <path>                         Directory to scan for --pending
 */

import { readFileSync, writeFileSync, readdirSync, statSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadConfig } from './config-loader.js';
import { digestDocument } from '../engines/digest.js';
import type { DigestResult } from '../engines/digest.js';
import { SqliteCortexStore } from '../stores/sqlite.js';
import { OllamaEmbedProvider, OllamaLLMProvider } from '../providers/ollama.js';
import type { CortexConfig } from '../core/config.js';
import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  file: string | null;
  pending: boolean;
  dryRun: boolean;
  pipeline: string[];
  namespace: string | null;
  dir: string;
}

interface FileFrontmatter {
  directive?: string;
  status?: string;
  post_digest?: string;
  [key: string]: unknown;
}

interface ParsedFile {
  frontmatter: FileFrontmatter;
  body: string;
  raw: string;
}

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

function parseArgs(args: string[]): ParsedArgs {
  let file: string | null = null;
  let pending = false;
  let dryRun = false;
  let pipeline: string[] = ['observe', 'reflect'];
  let namespace: string | null = null;
  let dir = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--pending') {
      pending = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--pipeline' && args[i + 1]) {
      pipeline = args[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--namespace' && args[i + 1]) {
      namespace = args[++i];
    } else if (arg === '--dir' && args[i + 1]) {
      dir = resolve(args[++i]);
    } else if (!arg.startsWith('--')) {
      file = arg;
    }
  }

  // --pending is implicit when --dry-run is given without a file
  if (dryRun && !file) {
    pending = true;
  }

  return { file, pending, dryRun, pipeline, namespace, dir };
}

// ─── Provider Setup ───────────────────────────────────────────────────────────

function createProviders(config: CortexConfig): {
  store: CortexStore;
  embed: EmbedProvider;
  llm: LLMProvider;
} {
  const store = new SqliteCortexStore(
    config.store_options?.sqlite_path ?? './cortex.db',
    config.store_options?.sqlite_path ? undefined : undefined,
  );

  const embed = new OllamaEmbedProvider({
    model: config.embed_options?.ollama_model,
    baseUrl: config.embed_options?.ollama_url,
  });

  const llm = new OllamaLLMProvider({
    model: config.llm_options?.ollama_model,
    baseUrl: config.llm_options?.ollama_url,
  });

  return { store, embed, llm };
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

function parseFileContent(content: string): ParsedFile {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content, raw: content };
  }

  const endMarker = trimmed.indexOf('\n---', 3);
  if (endMarker === -1) {
    return { frontmatter: {}, body: content, raw: content };
  }

  const yamlBlock = trimmed.slice(3, endMarker).trim();
  const body = trimmed.slice(endMarker + 4).trimStart();

  let frontmatter: FileFrontmatter = {};
  try {
    const parsed = parseYaml(yamlBlock);
    if (parsed && typeof parsed === 'object') {
      frontmatter = parsed as FileFrontmatter;
    }
  } catch {
    // Malformed frontmatter — treat as no frontmatter.
  }

  return { frontmatter, body, raw: content };
}

// ─── Frontmatter Update ───────────────────────────────────────────────────────

function updateFrontmatter(
  raw: string,
  updates: Record<string, unknown>,
): string {
  const trimmed = raw.trimStart();
  const leadingWhitespace = raw.slice(0, raw.length - trimmed.length);

  if (!trimmed.startsWith('---')) {
    // No existing frontmatter — prepend new block.
    const newFm = stringifyYaml(updates).trimEnd();
    return `${leadingWhitespace}---\n${newFm}\n---\n\n${trimmed}`;
  }

  const endMarker = trimmed.indexOf('\n---', 3);
  if (endMarker === -1) {
    return raw;
  }

  const yamlBlock = trimmed.slice(3, endMarker).trim();
  const afterFm = trimmed.slice(endMarker + 4);

  let existing: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(yamlBlock);
    if (parsed && typeof parsed === 'object') {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // Keep existing block unchanged if it can't be parsed.
    return raw;
  }

  const merged = { ...existing, ...updates };
  const newYaml = stringifyYaml(merged).trimEnd();
  return `${leadingWhitespace}---\n${newYaml}\n---${afterFm}`;
}

// ─── Post-Digest File Handling ────────────────────────────────────────────────

function applyPostDigest(filePath: string, postDigest: string | undefined): void {
  if (!postDigest) return;

  const dir = dirname(filePath);
  const name = basename(filePath);

  if (postDigest === 'archive') {
    const archiveDir = join(dir, 'Archive');
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }
    renameSync(filePath, join(archiveDir, name));
    process.stderr.write(`  moved to Archive/\n`);
  } else if (postDigest === 'trash') {
    const trashDir = join(dir, '_trash');
    if (!existsSync(trashDir)) {
      mkdirSync(trashDir, { recursive: true });
    }
    renameSync(filePath, join(trashDir, name));
    process.stderr.write(`  moved to _trash/\n`);
  }
}

// ─── Single File Processing ───────────────────────────────────────────────────

async function processSingleFile(
  filePath: string,
  pipeline: string[],
  namespace: string | null,
  store: CortexStore,
  embed: EmbedProvider,
  llm: LLMProvider,
): Promise<DigestResult> {
  const absPath = resolve(filePath);
  const content = readFileSync(absPath, 'utf-8');
  const { frontmatter } = parseFileContent(content);

  process.stderr.write(`Processing: ${absPath}\n`);

  const result = await digestDocument(content, store, embed, llm, {
    pipeline,
    namespace: namespace ?? undefined,
    source_file: absPath,
  });

  // Update frontmatter with digest results if file had frontmatter.
  const hasFrontmatter = content.trimStart().startsWith('---');
  if (hasFrontmatter) {
    const digestResultSummary = {
      observations: result.observation_ids.length,
      insights: result.insights.length,
      pipeline: result.pipeline_executed,
      processed_at: result.processed_at.toISOString(),
    };

    const updated = updateFrontmatter(content, {
      status: 'digested',
      digest_result: digestResultSummary,
    });
    writeFileSync(absPath, updated, 'utf-8');
  }

  process.stderr.write(
    `  observations: ${result.observation_ids.length}, ` +
    `insights: ${result.insights.length}, ` +
    `duration: ${result.duration_ms}ms\n`,
  );

  if (result.insights.length > 0) {
    for (const insight of result.insights) {
      process.stderr.write(`  insight: ${insight}\n`);
    }
  }

  applyPostDigest(absPath, frontmatter.post_digest);

  return result;
}

// ─── Recursive File Scan ──────────────────────────────────────────────────────

function scanMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip hidden directories and common non-content dirs.
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '_trash') {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...scanMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}

function findPendingFiles(dir: string): string[] {
  const allFiles = scanMarkdownFiles(dir);
  const pending: string[] = [];

  for (const filePath of allFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter } = parseFileContent(content);

      if (
        frontmatter.directive === 'digest' &&
        (frontmatter.status === 'active' || frontmatter.status === 'pending' || !frontmatter.status)
      ) {
        pending.push(filePath);
      }
    } catch {
      // Skip unreadable files.
    }
  }

  return pending;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function runDigest(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (!parsed.file && !parsed.pending) {
    process.stderr.write(
      'Usage:\n' +
      '  cortex-kit digest <file>                  Process a single file\n' +
      '  cortex-kit digest --pending               Process files with directive: digest\n' +
      '  cortex-kit digest --dry-run               Show what would be processed\n' +
      '  cortex-kit digest --pipeline <steps>      Custom pipeline (default: observe,reflect)\n' +
      '  cortex-kit digest --namespace <ns>        Target namespace\n' +
      '  cortex-kit digest --dir <path>            Directory to scan for --pending\n',
    );
    process.exit(1);
  }

  if (parsed.file) {
    // Single file mode.
    const absPath = resolve(parsed.file);

    // Verify the file exists before setting up providers.
    try {
      statSync(absPath);
    } catch {
      process.stderr.write(`Error: file not found: ${absPath}\n`);
      process.exit(1);
    }

    const config = loadConfig();
    const { store, embed, llm } = createProviders(config);

    await processSingleFile(absPath, parsed.pipeline, parsed.namespace, store, embed, llm);
    return;
  }

  // --pending mode (includes --dry-run).
  const files = findPendingFiles(parsed.dir);

  if (files.length === 0) {
    process.stderr.write(`No pending files found in: ${parsed.dir}\n`);
    return;
  }

  if (parsed.dryRun) {
    process.stderr.write(`Dry run — ${files.length} file(s) would be processed:\n`);
    for (const f of files) {
      const content = readFileSync(f, 'utf-8');
      const { frontmatter } = parseFileContent(content);
      const postDigest = frontmatter.post_digest ? ` [post_digest: ${frontmatter.post_digest}]` : '';
      process.stderr.write(`  ${f}${postDigest}\n`);
    }
    return;
  }

  const config = loadConfig();
  const { store, embed, llm } = createProviders(config);

  let totalObservations = 0;
  let totalInsights = 0;
  let processed = 0;
  let failed = 0;

  for (const filePath of files) {
    try {
      const result = await processSingleFile(
        filePath,
        parsed.pipeline,
        parsed.namespace,
        store,
        embed,
        llm,
      );
      totalObservations += result.observation_ids.length;
      totalInsights += result.insights.length;
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  failed: ${message}\n`);
      failed++;
    }
  }

  process.stderr.write(
    `\nSummary: ${processed} file(s) processed` +
    (failed > 0 ? `, ${failed} failed` : '') +
    `, ${totalObservations} observations, ${totalInsights} insights\n`,
  );
}
