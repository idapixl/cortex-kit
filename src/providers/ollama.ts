/**
 * OllamaEmbedProvider and OllamaLLMProvider — Ollama REST API implementations.
 *
 * Talks to a local Ollama instance (default: http://localhost:11434).
 * Uses Node.js built-in fetch — no extra HTTP dependencies.
 *
 * Defaults:
 *   embed model  — qwen3-embedding:0.6b (1024 dimensions, MRL to 32)
 *   LLM model    — qwen2.5:14b
 */

import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider, GenerateOptions, GenerateJSONOptions } from '../core/llm.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip <think>...</think> blocks from model output (qwen3, phi4-reasoning). */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

async function ollamaPost<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(
      `Ollama not reachable at ${baseUrl}. Is Ollama running?`,
      { cause },
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(
      `Ollama request to ${path} failed: HTTP ${response.status} — ${text}`,
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// OllamaEmbedProvider
// ---------------------------------------------------------------------------

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbedProvider implements EmbedProvider {
  readonly name = 'ollama';
  readonly dimensions: number;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options?: {
    model?: string;
    baseUrl?: string;
    dimensions?: number;
  }) {
    this.model = options?.model ?? 'qwen3-embedding:0.6b';
    this.baseUrl = options?.baseUrl ?? 'http://localhost:11434';
    this.dimensions = options?.dimensions ?? 1024;
  }

  async embed(text: string): Promise<number[]> {
    const data = await ollamaPost<OllamaEmbedResponse>(
      this.baseUrl,
      '/api/embed',
      { model: this.model, input: text },
    );
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const data = await ollamaPost<OllamaEmbedResponse>(
      this.baseUrl,
      '/api/embed',
      { model: this.model, input: texts },
    );
    return data.embeddings;
  }
}

// ---------------------------------------------------------------------------
// OllamaLLMProvider
// ---------------------------------------------------------------------------

interface OllamaGenerateResponse {
  response: string;
}

export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly modelId: string;

  private readonly baseUrl: string;

  constructor(options?: {
    model?: string;
    baseUrl?: string;
  }) {
    this.modelId = options?.model ?? 'qwen3:14b';
    this.baseUrl = options?.baseUrl ?? 'http://localhost:11434';
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      stream: false,
      options: {
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { num_predict: options.maxTokens }),
      },
    };

    if (options?.systemPrompt) {
      body['system'] = options.systemPrompt;
    }

    const data = await ollamaPost<OllamaGenerateResponse>(
      this.baseUrl,
      '/api/generate',
      body,
    );

    return stripThinking(data.response);
  }

  async generateJSON<T>(prompt: string, options?: GenerateJSONOptions): Promise<T> {
    let systemPrompt = options?.systemPrompt ?? '';

    if (options?.schema) {
      const schemaInstruction = `Respond with JSON matching this schema: ${JSON.stringify(options.schema)}`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schemaInstruction}` : schemaInstruction;
    }

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      stream: false,
      format: 'json',
      options: {
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { num_predict: options.maxTokens }),
      },
    };

    if (systemPrompt) {
      body['system'] = systemPrompt;
    }

    const data = await ollamaPost<OllamaGenerateResponse>(
      this.baseUrl,
      '/api/generate',
      body,
    );

    try {
      return JSON.parse(stripThinking(data.response)) as T;
    } catch (cause) {
      throw new Error(
        `OllamaLLMProvider.generateJSON: failed to parse JSON response.\nRaw response: ${data.response}`,
        { cause },
      );
    }
  }
}
