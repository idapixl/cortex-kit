/**
 * BuiltInEmbedProvider — local embeddings using @huggingface/transformers (optional peer dependency).
 *
 * Uses all-MiniLM-L6-v2 (23MB, 384 dimensions) by default.
 * No Ollama, no API keys, no external services needed.
 * Model is downloaded on first use and cached locally.
 *
 * Requires: `npm install @huggingface/transformers`
 */

import type { EmbedProvider } from '../core/embed.js';

let pipeline: ((text: string | string[], options?: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>) | null = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  const log = (s: string) => process.stderr.write(s + '\n');

  let createPipeline;
  try {
    // @ts-ignore — optional peer dependency, may or may not be installed
    ({ pipeline: createPipeline } = await import('@huggingface/transformers'));
  } catch {
    throw new Error(
      'Built-in embeddings require @huggingface/transformers. Install it: npm install @huggingface/transformers'
    );
  }

  let downloadStarted = false;
  pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'fp32',
    progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
      if (progress.status === 'download' && !downloadStarted) {
        downloadStarted = true;
        log('[cortex] downloading embedding model (23MB, one-time) ...');
      }
      if (progress.status === 'ready' && downloadStarted) {
        log('[cortex] model cached \u2014 future starts are instant');
      }
    },
  }) as unknown as typeof pipeline;

  return pipeline!;
}

export class BuiltInEmbedProvider implements EmbedProvider {
  readonly dimensions = 384;
  readonly name = 'built-in (all-MiniLM-L6-v2)';

  async embed(text: string): Promise<number[]> {
    const pipe = await getPipeline();
    const output = await pipe!(text, { pooling: 'mean', normalize: true });
    return output.tolist()[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await getPipeline();
    const output = await pipe!(texts, { pooling: 'mean', normalize: true });
    return output.tolist();
  }
}
