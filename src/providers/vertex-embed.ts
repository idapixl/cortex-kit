/**
 * VertexEmbedProvider — Vertex AI text-embedding-004 via @google-cloud/aiplatform.
 *
 * Uses PredictionServiceClient (NOT @google-cloud/vertexai, which only supports
 * generative models). Returns 768-dimension vectors by default.
 */

import type { EmbedProvider } from '../core/embed.js';

export type VertexEmbedTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING';

export interface VertexEmbedOptions {
  /** GCP project ID. Falls back to GOOGLE_CLOUD_PROJECT env var. */
  projectId?: string;
  /** GCP region (default: us-central1). */
  location?: string;
  /** Embedding model name (default: text-embedding-004). */
  model?: string;
  /** Output dimensionality (default: 768). */
  dimensions?: number;
  /** Max concurrent requests per batch (default: 5). */
  batchConcurrency?: number;
  /** Default task type for embeddings (default: SEMANTIC_SIMILARITY). */
  taskType?: VertexEmbedTaskType;
}

export class VertexEmbedProvider implements EmbedProvider {
  readonly name = 'vertex';
  readonly dimensions: number;

  private readonly projectId: string;
  private readonly location: string;
  private readonly model: string;
  private readonly batchConcurrency: number;
  private readonly taskType: VertexEmbedTaskType;

  private readonly client: import('@google-cloud/aiplatform').PredictionServiceClient;
  private readonly helpers: typeof import('@google-cloud/aiplatform').helpers;

  constructor(
    options: VertexEmbedOptions,
    client: import('@google-cloud/aiplatform').PredictionServiceClient,
    helpersModule: typeof import('@google-cloud/aiplatform').helpers,
  ) {
    this.projectId = options.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '';
    this.location = options.location ?? 'us-central1';
    this.model = options.model ?? 'text-embedding-004';
    this.dimensions = options.dimensions ?? 768;
    this.batchConcurrency = options.batchConcurrency ?? 5;
    this.taskType = options.taskType ?? 'SEMANTIC_SIMILARITY';

    if (!this.projectId) {
      throw new Error('VertexEmbedProvider: projectId is required (config or GOOGLE_CLOUD_PROJECT env)');
    }

    this.client = client;
    this.helpers = helpersModule;
  }

  private get endpoint(): string {
    return `projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.model}`;
  }

  async embed(text: string): Promise<number[]> {
    const instance = this.helpers.toValue({
      content: text,
      task_type: this.taskType,
    });

    const parameters = this.helpers.toValue({
      outputDimensionality: this.dimensions,
    });

    const [response] = await this.client.predict({
      endpoint: this.endpoint,
      instances: [instance!],
      parameters,
    });

    const prediction = response.predictions?.[0];
    if (!prediction) throw new Error(`VertexEmbedProvider: no prediction returned for: "${text.slice(0, 50)}"`);

    const values =
      prediction.structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values?.map(
        (v) => v.numberValue ?? 0,
      );

    if (!values || values.length === 0) {
      throw new Error(`VertexEmbedProvider: empty embedding for: "${text.slice(0, 50)}"`);
    }

    return values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchConcurrency) {
      const chunk = texts.slice(i, i + this.batchConcurrency);
      const embeddings = await Promise.all(chunk.map((t) => this.embed(t)));
      results.push(...embeddings);

      // Brief pause between batches to respect rate limits
      if (i + this.batchConcurrency < texts.length) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    return results;
  }
}
