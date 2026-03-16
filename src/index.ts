/**
 * cortex-engine — portable cognitive engine for AI agents.
 *
 * Public API surface. Everything exported here is part of the stable API.
 */

// Core interfaces
export type { CortexStore } from './core/store.js';
export type { EmbedProvider } from './core/embed.js';
export type { LLMProvider, GenerateOptions, GenerateJSONOptions } from './core/llm.js';
export type { NLIProvider, NLIResult, NLILabel } from './core/nli.js';

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
  ObservationContentType,
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
  aggregatedRetrieval,
  multiAnchorRetrieval,
  memoryToSummary,
  SIMILARITY_MERGE,
  SIMILARITY_LINK,
  ACTIVATION_DECAY,
  MAX_ACTIVATION_DEPTH,
} from './engines/memory.js';

export { dreamConsolidate, dreamPhaseA, dreamPhaseB } from './engines/cognition.js';
export type {
  DreamResult,
  DreamOptions,
  ClusterPhaseResult,
  RefinePhaseResult,
  CreatePhaseResult,
  ConnectPhaseResult,
  ScorePhaseResult,
  AbstractPhaseResult,
  ReportPhaseResult,
} from './engines/cognition.js';

export { computeFiedlerValue, detectPESaturation } from './engines/graph-metrics.js';
export type { PESaturationResult } from './engines/graph-metrics.js';

export { digestDocument } from './engines/digest.js';
export type { DigestOptions, DigestResult } from './engines/digest.js';

// Stores
export { SqliteCortexStore } from './stores/sqlite.js';
export { FirestoreCortexStore } from './stores/firestore.js';
export type { FirestoreStoreOptions } from './stores/firestore.js';


// Namespace
export { ScopedStore } from './namespace/scoped-store.js';
export { NamespaceManager } from './namespace/manager.js';

// Providers — only always-available providers are re-exported as values.
// Vertex providers use optional peer deps and must be imported directly
// from 'cortex-engine/providers/vertex-embed' or 'cortex-engine/providers/vertex-llm'
// to avoid breaking consumers who don't install @google-cloud/*.
export { OllamaEmbedProvider, OllamaLLMProvider } from './providers/ollama.js';
export type { VertexEmbedOptions, VertexEmbedTaskType } from './providers/vertex-embed.js';
export type { VertexLLMOptions } from './providers/vertex-llm.js';
export { LocalNLIProvider, nliToCortexVerdict } from './providers/nli-http.js';
export { OpenAICompatibleLLMProvider } from './providers/openai-compatible.js';
export type { OpenAICompatibleOptions } from './providers/openai-compatible.js';

// Triggers
export { TriggerRegistry } from './triggers/registry.js';
export type { ResolvedTrigger } from './triggers/registry.js';
export { executeIngestionPipeline } from './triggers/pipeline.js';
export type { ToolHandler, PipelineResult, PipelineStepResult } from './triggers/pipeline.js';

// Bridges
export { BridgeRegistry } from './bridges/registry.js';
export type { ResolvedBridgeRule } from './bridges/registry.js';
export { evaluateCondition, interpolateTemplate, checkBridges } from './bridges/bridge.js';
export type { BridgeContext, BridgeResult } from './bridges/bridge.js';

// MCP server
export { createServer, startServer } from './mcp/server.js';
export { createTools, CORE_TOOLS } from './mcp/tools.js';
export type { ToolDefinition, ToolContext, ToolPlugin } from './mcp/tools.js';

// Plugins
export { loadPlugins } from './plugins/loader.js';

// Reflex — portable safety guardrails (re-exported for convenience)
export { RuleEngine, loadRuleFile, loadRuleDirectory, CORE_RULES } from '@fozikio/reflex';
export type {
  ReflexRule,
  ReflexEventData,
  EvaluationResult as ReflexResult,
  ReflexConfig,
} from '@fozikio/reflex';

// Built-in tools (threads, journal, evolution)
export { threadCreateTool } from './tools/thread-create.js';
export { threadUpdateTool } from './tools/thread-update.js';
export { threadResolveTool } from './tools/thread-resolve.js';
export { threadsListTool } from './tools/threads-list.js';
export { journalWriteTool } from './tools/journal-write.js';
export { journalReadTool } from './tools/journal-read.js';
export { evolveTool } from './tools/evolve.js';
export { evolutionListTool } from './tools/evolution-list.js';
export { goalTool } from './tools/goal.js';
