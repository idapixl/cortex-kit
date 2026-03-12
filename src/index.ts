/**
 * cortex-engine — portable cognitive engine for AI agents.
 *
 * Public API surface. Everything exported here is part of the stable API.
 */

// Core interfaces
export type { CortexStore } from './core/store.js';
export type { EmbedProvider } from './core/embed.js';
export type { LLMProvider, GenerateOptions, GenerateJSONOptions } from './core/llm.js';

// Configuration
export type {
  CortexConfig,
  AgentConfig,
  NamespaceConfig,
  IngestionTriggerConfig,
  BridgeConfig,
  BridgeRuleConfig,
  ModelProvenanceConfig,
  BenchmarkConfig,
} from './core/config.js';
export { DEFAULT_CONFIG } from './core/config.js';

// Session & provenance
export { Session } from './core/session.js';

// Types
export type {
  Memory,
  MemorySummary,
  MemoryCategory,
  FSRSData,
  FSRSState,
  Edge,
  EdgeRelation,
  Observation,
  OpsEntry,
  OpsEntryType,
  OpsStatus,
  OpsFilters,
  Signal,
  SignalType,
  BeliefEntry,
  SearchResult,
  ActivationResult,
  IngestDecision,
  GateResult,
  ScheduleResult,
  ModelProvenance,
  ConfidenceTier,
  QueryFilter,
} from './core/types.js';

// Engines (pure functions, storage-agnostic)
export {
  retrievability,
  scheduleNext,
  initialStability,
  FSRS_WEIGHTS,
  DESIRED_RETENTION,
} from './engines/fsrs.js';

export { extractKeywords } from './engines/keywords.js';

export {
  predictionErrorGate,
  hydeExpand,
  spreadActivation,
  memoryToSummary,
  SIMILARITY_MERGE,
  SIMILARITY_LINK,
  ACTIVATION_DECAY,
  MAX_ACTIVATION_DEPTH,
} from './engines/memory.js';

// Stores
export { SqliteCortexStore } from './stores/sqlite.js';

// Providers
export { OllamaEmbedProvider, OllamaLLMProvider } from './providers/ollama.js';
