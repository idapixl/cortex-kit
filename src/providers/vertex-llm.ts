/**
 * VertexLLMProvider — Vertex AI Gemini via @google-cloud/vertexai.
 *
 * Generalized provider with no idapixl-specific dependencies.
 * Supports systemPrompt, schema instructions, and JSON fence stripping.
 */

import type { LLMProvider, GenerateOptions, GenerateJSONOptions } from '../core/llm.js';

export interface VertexLLMOptions {
  /** GCP project ID. Falls back to GOOGLE_CLOUD_PROJECT env var. */
  projectId?: string;
  /** GCP region (default: us-central1). */
  location?: string;
  /** Gemini model ID (default: gemini-2.5-flash). */
  model?: string;
}

/**
 * Strip common code fence wrappers from LLM JSON output.
 * Models often return ```json ... ``` or ``` ... ``` around JSON.
 */
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export class VertexLLMProvider implements LLMProvider {
  readonly name = 'vertex-gemini';
  readonly modelId: string;

  private readonly projectId: string;
  private readonly vertexAI: import('@google-cloud/vertexai').VertexAI;

  constructor(
    options: VertexLLMOptions,
    vertexAI: import('@google-cloud/vertexai').VertexAI,
  ) {
    this.projectId = options.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '';
    this.modelId = options.model ?? 'gemini-2.5-flash';

    if (!this.projectId) {
      throw new Error('VertexLLMProvider: projectId is required (config or GOOGLE_CLOUD_PROJECT env)');
    }

    this.vertexAI = vertexAI;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const model = this.vertexAI.preview.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 1024,
      },
      ...(options?.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
    });

    const result = await model.generateContent(prompt);
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('VertexLLMProvider: empty response');

    return text.trim();
  }

  async generateJSON<T>(prompt: string, options?: GenerateJSONOptions): Promise<T> {
    // Build system prompt with optional schema instruction
    let systemPrompt = options?.systemPrompt ?? '';
    if (options?.schema) {
      const schemaInstruction = `Respond with JSON matching this schema: ${JSON.stringify(options.schema)}`;
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${schemaInstruction}` : schemaInstruction;
    }

    const model = this.vertexAI.preview.getGenerativeModel({
      model: this.modelId,
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxTokens ?? 2048,
        responseMimeType: 'application/json',
      },
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    });

    const result = await model.generateContent(prompt);
    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('VertexLLMProvider: empty response');

    const cleaned = stripJsonFences(text);
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      const parseError = err instanceof Error ? err.message : String(err);
      throw new Error(
        `VertexLLMProvider: failed to parse JSON response: ${parseError}\nRaw output (first 500 chars): ${text.slice(0, 500)}`,
        { cause: err },
      );
    }
  }
}
