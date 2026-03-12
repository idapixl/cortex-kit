/**
 * NLIProvider — Natural Language Inference abstraction for cortex-engine.
 *
 * Classifies text pairs as contradiction, entailment, or neutral.
 * Used for automated contradiction detection in dream consolidation
 * and the validate tool.
 *
 * Implementations: LocalNLIProvider (HTTP service), LLMFallbackNLIProvider.
 */

export type NLILabel = 'contradiction' | 'entailment' | 'neutral';

export interface NLIResult {
  label: NLILabel;
  scores: Record<NLILabel, number>;
}

export interface NLIProvider {
  /** Classify the relationship between a premise and hypothesis. */
  classify(premise: string, hypothesis: string): Promise<NLIResult>;

  /** Classify multiple pairs in a batch. */
  classifyBatch?(pairs: Array<{ premise: string; hypothesis: string }>): Promise<NLIResult[]>;

  /** Provider name for provenance tracking. */
  readonly name: string;
}
