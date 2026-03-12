/**
 * LocalNLIProvider — HTTP client for the NLI cross-encoder service.
 *
 * Talks to a local Python service running cross-encoder/nli-roberta-base
 * (default: http://127.0.0.1:11435). Falls back gracefully if the
 * service is unavailable.
 */

import type { NLIProvider, NLIResult, NLILabel } from '../core/nli.js';

export class LocalNLIProvider implements NLIProvider {
  readonly name = 'nli-http';
  private readonly baseUrl: string;

  constructor(options?: { baseUrl?: string }) {
    this.baseUrl = options?.baseUrl ?? 'http://127.0.0.1:11435';
  }

  async classify(premise: string, hypothesis: string): Promise<NLIResult> {
    const response = await fetch(`${this.baseUrl}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ premise, hypothesis }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(`NLI service error: HTTP ${response.status} — ${text}`);
    }

    return response.json() as Promise<NLIResult>;
  }

  async classifyBatch(
    pairs: Array<{ premise: string; hypothesis: string }>,
  ): Promise<NLIResult[]> {
    const response = await fetch(`${this.baseUrl}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairs }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      throw new Error(`NLI batch error: HTTP ${response.status} — ${text}`);
    }

    const data = await response.json() as { results: NLIResult[] };
    return data.results;
  }

  /**
   * Check if the NLI service is available.
   * Returns false if the service is down — callers can fall back to LLM.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Map NLI labels to the contradiction evaluation vocabulary used by cortex.
 *
 * NLI "contradiction" → cortex "genuine"
 * NLI "entailment"    → cortex "complementary"
 * NLI "neutral"       → cortex "tension" (may or may not be meaningful)
 */
export function nliToCortexVerdict(
  label: NLILabel,
  scores: Record<NLILabel, number>,
): 'genuine' | 'tension' | 'complementary' | 'unrelated' {
  // High-confidence contradiction
  if (label === 'contradiction' && scores.contradiction > 0.8) {
    return 'genuine';
  }

  // High-confidence entailment = complementary
  if (label === 'entailment' && scores.entailment > 0.7) {
    return 'complementary';
  }

  // Low scores all around = likely unrelated
  const maxScore = Math.max(scores.contradiction, scores.entailment, scores.neutral);
  if (maxScore < 0.5) {
    return 'unrelated';
  }

  // Moderate contradiction signal = productive tension
  if (label === 'contradiction' && scores.contradiction > 0.4) {
    return 'tension';
  }

  // Default: neutral with some signal = tension
  return 'tension';
}
