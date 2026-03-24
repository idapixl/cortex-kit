/**
 * OpenAICompatibleLLMProvider — works with any OpenAI-compatible API.
 *
 * Covers: OpenAI, DeepSeek, Kimi (Moonshot AI), Hugging Face Inference, OpenRouter,
 * Together AI, Fireworks, LM Studio, vLLM, and any other service
 * that implements the /v1/chat/completions endpoint.
 *
 * Uses native fetch — no SDK dependency required.
 *
 * Defaults:
 *   base URL  — https://api.openai.com/v1  (override for other providers)
 *   model     — gpt-4o
 *   API key   — OPENAI_API_KEY env var (also checks provider-specific vars)
 */

import type { LLMProvider, GenerateOptions, GenerateJSONOptions } from '../core/llm.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Provider-specific defaults
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS: Record<string, { baseUrl: string; envKey: string }> = {
  openai:       { baseUrl: 'https://api.openai.com/v1',         envKey: 'OPENAI_API_KEY' },
  deepseek:     { baseUrl: 'https://api.deepseek.com/v1',       envKey: 'DEEPSEEK_API_KEY' },
  huggingface:  { baseUrl: 'https://router.huggingface.co/v1',  envKey: 'HF_TOKEN' },
  openrouter:   { baseUrl: 'https://openrouter.ai/api/v1',      envKey: 'OPENROUTER_API_KEY' },
  together:     { baseUrl: 'https://api.together.xyz/v1',        envKey: 'TOGETHER_API_KEY' },
  fireworks:    { baseUrl: 'https://api.fireworks.ai/inference/v1', envKey: 'FIREWORKS_API_KEY' },
  kimi:         { baseUrl: 'https://api.moonshot.cn/v1',        envKey: 'MOONSHOT_API_KEY' },
};

/** Detect which API key is available and return the appropriate config. */
function detectProvider(baseUrl?: string): { baseUrl: string; apiKey: string } {
  // If a custom base URL is provided, try the generic key
  if (baseUrl) {
    const apiKey = process.env['OPENAI_API_KEY']
      ?? process.env['LLM_API_KEY']
      ?? '';
    // Also check provider-specific keys based on URL
    for (const [, config] of Object.entries(KNOWN_PROVIDERS)) {
      if (baseUrl.includes(new URL(config.baseUrl).hostname)) {
        const key = process.env[config.envKey];
        if (key) return { baseUrl, apiKey: key };
      }
    }
    return { baseUrl, apiKey };
  }

  // Auto-detect: try each known provider in order
  for (const [, config] of Object.entries(KNOWN_PROVIDERS)) {
    const key = process.env[config.envKey];
    if (key) return { baseUrl: config.baseUrl, apiKey: key };
  }

  // Fallback: no key found (might work for local servers like LM Studio)
  return { baseUrl: 'http://localhost:1234/v1', apiKey: '' };
}

// ---------------------------------------------------------------------------
// Strip code fences from JSON output
// ---------------------------------------------------------------------------

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

// ---------------------------------------------------------------------------
// OpenAICompatibleLLMProvider
// ---------------------------------------------------------------------------

export interface OpenAICompatibleOptions {
  /** Model ID (default: gpt-4o). */
  model?: string;
  /** Base URL for the API (default: auto-detected from env vars). */
  baseUrl?: string;
  /** API key (default: auto-detected from env vars). */
  apiKey?: string;
  /** Provider name for provenance tracking (default: auto-detected). */
  providerName?: string;
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name: string;
  readonly modelId: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options?: OpenAICompatibleOptions) {
    this.modelId = options?.model ?? 'gpt-4o';

    const detected = detectProvider(options?.baseUrl);
    this.baseUrl = options?.baseUrl ?? detected.baseUrl;
    this.apiKey = options?.apiKey ?? detected.apiKey;

    // Derive provider name from base URL if not specified
    this.name = options?.providerName
      ?? Object.entries(KNOWN_PROVIDERS).find(([, c]) =>
        this.baseUrl.includes(new URL(c.baseUrl).hostname)
      )?.[0]
      ?? 'openai-compatible';
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const messages: ChatMessage[] = [];

    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      ...(options?.temperature !== undefined && { temperature: options.temperature }),
      ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    };

    const data = await this.post<ChatCompletionResponse>(body);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name}: empty response`);

    return content.trim();
  }

  async generateJSON<T>(prompt: string, options?: GenerateJSONOptions): Promise<T> {
    let systemPrompt = options?.systemPrompt ?? '';

    if (options?.schema) {
      const schemaInstruction = `Respond with JSON matching this schema: ${JSON.stringify(options.schema)}`;
      systemPrompt = systemPrompt
        ? `${systemPrompt}\n\n${schemaInstruction}`
        : schemaInstruction;
    }

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      temperature: options?.temperature ?? 0.2,
      ...(options?.maxTokens !== undefined && { max_tokens: options.maxTokens }),
      response_format: { type: 'json_object' },
    };

    const data = await this.post<ChatCompletionResponse>(body);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name}: empty response`);

    const cleaned = stripJsonFences(content);
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      const parseError = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${this.name}: failed to parse JSON response: ${parseError}\nRaw output (first 500 chars): ${content.slice(0, 500)}`,
        { cause: err },
      );
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private async post<T>(body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new Error(
        `${this.name}: API not reachable at ${this.baseUrl}. Check your connection and API key.`,
        { cause },
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(
        `${this.name}: API request failed: HTTP ${response.status} — ${text}`,
      );
    }

    return response.json() as Promise<T>;
  }
}
