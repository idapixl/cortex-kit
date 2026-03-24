/**
 * CortexConfig — configuration types and loader for cortex-engine.
 *
 * Config is loaded from .fozikio/config.yaml (or passed programmatically).
 */

import type { ConfidenceTier } from './types.js';

// ─── Namespace Config ─────────────────────────────────────────────────────────

export interface NamespaceConfig {
  description?: string;
  default?: boolean;
  cognitive_tools: string[];
  collections_prefix: string;
  ingestion_triggers?: Record<string, IngestionTriggerConfig>;

  /** Similarity threshold above which observations are merged (default: 0.85). */
  similarity_merge?: number;
  /** Similarity threshold above which observations are linked (default: 0.50). */
  similarity_link?: number;
  /** Whether other namespaces can read this namespace's memories (default: false). */
  queryable?: boolean;
}

export interface IngestionTriggerConfig {
  pipeline: string[];
}

// ─── Bridge Config ────────────────────────────────────────────────────────────

export interface BridgeRuleConfig {
  event: string;
  condition?: string;
  pipeline: string[];
  template?: string;
}

export interface BridgeConfig {
  name: string;
  from: string;
  to: string;
  on: BridgeRuleConfig[];
}

// ─── Model Provenance Config ──────────────────────────────────────────────────

export interface ModelProvenanceConfig {
  default_model: string;
  confidence_tiers: Record<ConfidenceTier, string[]>;
  conflict_policy: 'weight_by_tier' | 'flag_for_review' | 'latest_wins';
}

// ─── Benchmark Config ─────────────────────────────────────────────────────────

export interface BenchmarkConfig {
  enabled: boolean;
  track_models: string[];
  metrics: string[];
  export_path: string;
}

// ─── Top-Level Config ─────────────────────────────────────────────────────────

export interface CortexConfig {
  /** Storage backend: 'sqlite' | 'firestore' */
  store: 'sqlite' | 'firestore';

  /** Embedding provider: 'built-in' (default, no setup) | 'ollama' | 'vertex' | 'openai' */
  embed: 'built-in' | 'ollama' | 'vertex' | 'openai';

  /** LLM provider: 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'kimi' */
  llm: 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'kimi';

  /** Named cognitive namespaces. */
  namespaces: Record<string, NamespaceConfig>;

  /** Inter-namespace bridges. */
  bridges?: BridgeConfig[];

  /** Model provenance tracking config. */
  model_provenance?: ModelProvenanceConfig;

  /** Plugin packages to load (npm package names or local paths). */
  plugins?: string[];

  /** Benchmark/research mode config. */
  benchmark?: BenchmarkConfig;

  /** Federation settings for multi-instance coordination via sigil. */
  federation?: {
    /** Sigil server URL (e.g. http://localhost:8090) */
    sigil_url: string;
    /** Sigil auth token */
    sigil_token?: string;
    /** This agent's externally-reachable cortex REST URL */
    self_url?: string;
    /** Auto-register with sigil on startup (default: true) */
    auto_register?: boolean;
  };

  /** Store-specific options. */
  store_options?: {
    /** SQLite: path to database file (default: ./cortex.db) */
    sqlite_path?: string;
    /** Firestore: GCP project ID */
    gcp_project_id?: string;
    /** Firestore: database ID (default: '(default)') */
    firestore_database_id?: string;
  };

  /** Embed provider-specific options. */
  embed_options?: {
    /** Ollama: model name (default: qwen3-embedding:0.6b) */
    ollama_model?: string;
    /** Ollama: base URL (default: http://localhost:11434) */
    ollama_url?: string;
    /** Vertex AI: model name (default: text-embedding-004) */
    vertex_model?: string;
    /** Vertex AI: GCP region (default: us-central1) */
    vertex_location?: string;
    /** OpenAI: model name (default: text-embedding-3-small) */
    openai_model?: string;
  };

  /** LLM provider-specific options. */
  llm_options?: {
    /** Ollama: model name (default: qwen2.5:14b) */
    ollama_model?: string;
    /** Ollama: base URL (default: http://localhost:11434) */
    ollama_url?: string;
    /** Gemini: model name (default: gemini-2.5-flash) */
    gemini_model?: string;
    /** Vertex AI / Gemini: GCP region (default: us-central1) */
    vertex_location?: string;
    /** Anthropic: model name (default: claude-sonnet-4-6) */
    anthropic_model?: string;
    /** OpenAI-compatible: model name (default: gpt-4o) */
    openai_model?: string;
    /** OpenAI-compatible: base URL (auto-detected from env vars if omitted) */
    openai_base_url?: string;
    /** OpenAI-compatible: API key (auto-detected from env vars if omitted) */
    openai_api_key?: string;
    /** Kimi (Moonshot AI): model name (default: kimi-k2-0711-preview) */
    kimi_model?: string;
    /** Kimi (Moonshot AI): API key (default: MOONSHOT_API_KEY env var) */
    kimi_api_key?: string;
  };
}

// ─── Agent Entry (multi-agent registry) ──────────────────────────────────────

export interface AgentEntry {
  namespace: string;
  profile?: string;
  description?: string;
}

// ─── Agent Config (wraps cortex config) ───────────────────────────────────────

export interface AgentConfig {
  agent?: {
    name: string;
    type?: string;
    version?: string;
    description?: string;
  };
  agents?: Record<string, AgentEntry>;
  cortex: CortexConfig;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: CortexConfig = {
  store: 'sqlite',
  embed: 'built-in',
  llm: 'ollama',
  namespaces: {
    default: {
      default: true,
      description: 'Default namespace',
      cognitive_tools: ['observe', 'query', 'recall', 'neighbors', 'predict'],
      collections_prefix: '',
    },
  },
  model_provenance: {
    default_model: 'unknown',
    confidence_tiers: {
      high: ['claude-opus-4-6', 'gemini-2.5-pro'],
      medium: ['claude-sonnet-4-6', 'gemini-2.5-flash', 'gpt-4o'],
      low: ['qwen2.5:14b', 'llama3:8b', 'gemma2:9b'],
    },
    conflict_policy: 'weight_by_tier',
  },
};
