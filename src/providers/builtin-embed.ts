/**
 * BuiltInEmbedProvider — zero-dependency local embeddings using @huggingface/transformers.
 *
 * Uses all-MiniLM-L6-v2 (23MB, 384 dimensions) by default.
 * No Ollama, no API keys, no external services needed.
 * Model is downloaded on first use and cached locally.
 *
 * This is the default embed provider — works immediately after npm install.
 */

import type { EmbedProvider } from '../core/embed.js';

let pipeline: ((text: string | string[], options?: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>) | null = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  // Dynamic import — @huggingface/transformers is an optional peer dependency
  const { pipeline: createPipeline } = await import('@huggingface/transformers');

  pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    // Use ONNX runtime for CPU inference
    dtype: 'fp32',
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
