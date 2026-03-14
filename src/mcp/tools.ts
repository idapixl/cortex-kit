/**
 * MCP tool definitions for cortex-engine.
 *
 * Each ToolDefinition contains a JSON schema for MCP and a working handler.
 * Handlers resolve the namespace, operate on the store, call engine functions,
 * inject provenance from the session, and fire triggers/bridges after writes.
 */

import type { CortexStore } from '../core/store.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import type { Session } from '../core/session.js';
import type { NamespaceManager } from '../namespace/manager.js';
import type { TriggerRegistry } from '../triggers/registry.js';
import type { BridgeRegistry } from '../bridges/registry.js';
import type { OpsEntryType, OpsStatus, QueryFilter } from '../core/types.js';
import { executeIngestionPipeline } from '../triggers/pipeline.js';
import { checkBridges } from '../bridges/bridge.js';
import {
  predictionErrorGate,
  hydeExpand,
  spreadActivation,
  memoryToSummary,
} from '../engines/memory.js';
import { extractKeywords } from '../engines/keywords.js';
import { retrievability, scheduleNext, elapsedDaysSince } from '../engines/fsrs.js';
import { dreamConsolidate } from '../engines/cognition.js';
import { digestDocument } from '../engines/digest.js';

// ─── Tool Context ─────────────────────────────────────────────────────────────

/** Tool context passed to all handlers. */
export interface ToolContext {
  namespaces: NamespaceManager;
  embed: EmbedProvider;
  llm: LLMProvider;
  session: Session;
  triggers: TriggerRegistry;
  bridges: BridgeRegistry;
  /** All registered tools (core + plugin), for trigger/bridge pipeline lookups. */
  allTools: ToolDefinition[];
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

/** MCP-compatible tool definition with a working handler. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<Record<string, unknown>>;
}

/** A plugin that contributes additional tools to the cortex engine. */
export interface ToolPlugin {
  name: string;
  tools: ToolDefinition[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`Missing required string argument: ${key}`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

function optNum(args: Record<string, unknown>, key: string, def: number): number {
  const v = args[key];
  return typeof v === 'number' ? v : def;
}

function optBool(args: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = args[key];
  return typeof v === 'boolean' ? v : def;
}

/** Build a tool lookup function for ingestion pipeline execution. */
function makeToolLookup(
  activeTools: ToolDefinition[],
  ctx: ToolContext,
): (name: string) => { name: string; handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>> } | undefined {
  return (name: string) => {
    const tool = activeTools.find(t => t.name === name);
    if (!tool) return undefined;
    return { name: tool.name, handler: (args) => tool.handler(args, ctx) };
  };
}

/** Check bridges for a given event in a source namespace. */
async function fireBridges(
  ctx: ToolContext,
  sourceNamespace: string,
  event: string,
  eventData: Record<string, unknown>,
  allTools: ToolDefinition[],
): Promise<void> {
  const rules = ctx.bridges.getRulesForEvent(sourceNamespace, event);
  if (rules.length === 0) return;

  const toolLookup = makeToolLookup(allTools, ctx);

  await checkBridges(
    rules,
    eventData,
    async (targetNamespace, text, metadata) => {
      const store = ctx.namespaces.getStore(targetNamespace);
      const triggers = ctx.triggers.getTriggersForEventInNamespace(event, targetNamespace);
      for (const trigger of triggers) {
        await executeIngestionPipeline(trigger, text, metadata, toolLookup);
      }
      void store; // store available for future direct pipeline use
    },
    { depth: 0, sourceNamespace, bridgeName: '' },
  );
}

/** Fire ingestion triggers for a given event in a namespace. */
async function fireTriggers(
  ctx: ToolContext,
  namespace: string,
  event: string,
  content: string,
  metadata: Record<string, unknown>,
  allTools: ToolDefinition[],
): Promise<void> {
  const triggers = ctx.triggers.getTriggersForEventInNamespace(event, namespace);
  const toolLookup = makeToolLookup(allTools, ctx);
  for (const trigger of triggers) {
    await executeIngestionPipeline(trigger, content, metadata, toolLookup);
  }
}

// ─── Core Tools ───────────────────────────────────────────────────────────────

const queryTool: ToolDefinition = {
  name: 'query',
  description: 'Search your memories by meaning. Returns the most relevant stored knowledge for a given topic or question. Use before writing new observations to avoid duplicates.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What to search for — a topic, question, or concept' },
      namespace: { type: 'string', description: 'Memory namespace to search (defaults to default)' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
      hyde: { type: 'boolean', description: 'Expand query for better conceptual matches (default: true)' },
    },
    required: ['text'],
  },
  async handler(args, ctx) {
    const text = str(args, 'text');
    const namespace = optStr(args, 'namespace');
    const limit = optNum(args, 'limit', 5);
    const useHyde = optBool(args, 'hyde', true);

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Embed query — with HyDE expansion if enabled
    let queryEmbedding: number[];
    if (useHyde) {
      queryEmbedding = await hydeExpand(text, ctx.llm, ctx.embed);
    } else {
      queryEmbedding = await ctx.embed.embed(text);
    }

    // Find nearest memories
    const nearest = await store.findNearest(queryEmbedding, limit);

    // Spread activation for richer results
    const activated = await spreadActivation(store, nearest);

    // Score retrievability and touch accessed memories
    const now = new Date();
    const results = await Promise.all(
      activated.slice(0, limit).map(async (r) => {
        const memory = await store.getMemory(r.memory.id);
        const daysSince = memory?.fsrs.last_review
          ? elapsedDaysSince(memory.fsrs.last_review)
          : 0;
        const ret = memory
          ? retrievability(memory.fsrs.stability, daysSince)
          : r.score;

        // Touch the memory (update access count + last_accessed)
        await store.touchMemory(r.memory.id, {});

        return {
          id: r.memory.id,
          name: r.memory.name,
          definition: r.memory.definition,
          category: r.memory.category,
          salience: r.memory.salience,
          confidence: r.memory.confidence,
          score: r.score,
          hop_count: r.hop_count,
          retrievability: ret,
          last_accessed: now.toISOString(),
          provenance: r.memory.provenance,
        };
      })
    );

    // Fire triggers and bridges after query
    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'query', text, { query: text, result_count: results.length }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'query', { query: text, result_count: results.length }, ctx.allTools);

    return {
      query: text,
      hyde_used: useHyde,
      namespace: resolvedNs,
      count: results.length,
      results,
    };
  },
};

const observeTool: ToolDefinition = {
  name: 'observe',
  description: 'Record a factual observation — something you learned, confirmed, or noticed to be true. Content should be declarative (statements of fact), not questions or speculation. For open questions use wonder(). For untested hypotheses use speculate(). Duplicate observations are automatically merged.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'A declarative statement of what you observed (e.g. "The auth system uses JWT tokens")' },
      namespace: { type: 'string', description: 'Target namespace (defaults to default namespace)' },
      salience: { type: 'number', description: 'Importance score 1-10 (default: 5)' },
      source_file: { type: 'string', description: 'Source file path for provenance' },
      source_section: { type: 'string', description: 'Source section or heading for provenance' },
    },
    required: ['text'],
  },
  async handler(args, ctx) {
    const text = str(args, 'text');
    const namespace = optStr(args, 'namespace');
    const salience = optNum(args, 'salience', 5);
    const sourceFile = optStr(args, 'source_file') ?? '';
    const sourceSection = optStr(args, 'source_section') ?? '';

    const store: CortexStore = ctx.namespaces.getStore(namespace);
    const provenance = ctx.session.getProvenance();

    // Embed the observation
    const embedding = await ctx.embed.embed(text);

    // Run prediction error gate with namespace-specific thresholds
    const nsConfig = ctx.namespaces.getConfig(namespace);
    const gate = await predictionErrorGate(store, embedding, {
      merge: nsConfig.similarity_merge,
      link: nsConfig.similarity_link,
    });

    // Extract keywords
    const keywords = extractKeywords(text);

    // Store the observation
    const id = await store.putObservation({
      content: text,
      source_file: sourceFile,
      source_section: sourceSection,
      salience,
      processed: false,
      prediction_error: gate.max_similarity > 0 ? 1 - gate.max_similarity : null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding,
      keywords,
      provenance,
    });

    const result = {
      id,
      decision: gate.decision,
      nearest_id: gate.nearest_id,
      max_similarity: gate.max_similarity,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      keywords,
      salience,
    };

    // Fire triggers and bridges after observe
    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'observe', text, { observation_id: id, decision: gate.decision }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'observe', result, ctx.allTools);

    return result;
  },
};

const wonderTool: ToolDefinition = {
  name: 'wonder',
  description: 'Record an open question or curiosity — something you want to explore but haven\'t resolved. Stored separately from factual observations so questions don\'t pollute knowledge retrieval. Use observe() for facts, wonder() for questions, speculate() for hypotheses.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The question or curiosity (e.g. "Why does the sync daemon stall after 300k seconds?")' },
      namespace: { type: 'string', description: 'Target namespace (defaults to default)' },
      salience: { type: 'number', description: 'Importance score 1-10 (default: 5)' },
      context: { type: 'string', description: 'What prompted this question' },
    },
    required: ['text'],
  },
  async handler(args, ctx) {
    const text = str(args, 'text');
    const namespace = optStr(args, 'namespace');
    const salience = optNum(args, 'salience', 5);
    const contextText = optStr(args, 'context') ?? '';

    const store: CortexStore = ctx.namespaces.getStore(namespace);
    const provenance = ctx.session.getProvenance();
    const embedding = await ctx.embed.embed(text);
    const keywords = extractKeywords(text);

    const id = await store.putObservation({
      content: text,
      source_file: contextText,
      source_section: 'wonder',
      salience,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding,
      keywords,
      provenance,
      content_type: 'interrogative',
    });

    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'wonder', text, { observation_id: id }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'wonder', { id, namespace: resolvedNs }, ctx.allTools);

    return {
      id,
      content_type: 'interrogative',
      namespace: resolvedNs,
      keywords,
      salience,
    };
  },
};

const speculateTool: ToolDefinition = {
  name: 'speculate',
  description: 'Record a hypothesis or untested idea — something that might be true but hasn\'t been confirmed. Stored with a speculative flag so it\'s excluded from default query results. Use observe() for confirmed facts, wonder() for questions, speculate() for "what if" ideas.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The hypothesis (e.g. "Switching to sessions might reduce token overhead")' },
      namespace: { type: 'string', description: 'Target namespace (defaults to default)' },
      salience: { type: 'number', description: 'Importance score 1-10 (default: 5)' },
      basis: { type: 'string', description: 'What evidence or reasoning supports this hypothesis' },
    },
    required: ['text'],
  },
  async handler(args, ctx) {
    const text = str(args, 'text');
    const namespace = optStr(args, 'namespace');
    const salience = optNum(args, 'salience', 5);
    const basis = optStr(args, 'basis') ?? '';

    const store: CortexStore = ctx.namespaces.getStore(namespace);
    const provenance = ctx.session.getProvenance();
    const embedding = await ctx.embed.embed(text);
    const keywords = extractKeywords(text);

    const id = await store.putObservation({
      content: text,
      source_file: basis,
      source_section: 'speculate',
      salience,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding,
      keywords,
      provenance,
      content_type: 'speculative',
    });

    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'speculate', text, { observation_id: id }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'speculate', { id, namespace: resolvedNs }, ctx.allTools);

    return {
      id,
      content_type: 'speculative',
      namespace: resolvedNs,
      keywords,
      salience,
    };
  },
};

const recallTool: ToolDefinition = {
  name: 'recall',
  description: 'List recent observations in chronological order. Use query() to search by meaning, recall() to see what was recorded lately. Filter by content_type to see only facts, questions, or hypotheses.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Namespace to query (defaults to default namespace)' },
      limit: { type: 'number', description: 'Max entries to return (default: 10)' },
      days: { type: 'number', description: 'How many days back to look (default: 7)' },
      content_type: { type: 'string', enum: ['declarative', 'interrogative', 'speculative', 'reflective'], description: 'Filter by content type. Omit to see all types.' },
    },
  },
  async handler(args, ctx) {
    const namespace = optStr(args, 'namespace');
    const limit = optNum(args, 'limit', 10);
    const days = optNum(args, 'days', 7);
    const contentType = optStr(args, 'content_type');

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Query observations ordered by created_at desc within the time window
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filters: QueryFilter[] = [
      { field: 'created_at', op: '>=', value: cutoff },
    ];
    if (contentType) {
      filters.push({ field: 'content_type', op: '==', value: contentType });
    }
    const observations = await store.query(
      'observations',
      filters,
      { limit, orderBy: 'created_at', orderDir: 'desc' },
    );

    return {
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      days,
      content_type_filter: contentType ?? 'all',
      count: observations.length,
      observations: observations.map(o => ({
        id: o['id'],
        content: o['content'],
        salience: o['salience'],
        keywords: o['keywords'],
        content_type: o['content_type'] ?? 'declarative',
        source_file: o['source_file'],
        created_at: o['created_at'],
        processed: o['processed'],
        provenance: o['provenance'],
      })),
    };
  },
};

const neighborsTool: ToolDefinition = {
  name: 'neighbors',
  description: 'Explore memories connected to a specific memory. Shows related concepts linked by edges in the knowledge graph. Use after query() to explore around a result.',
  inputSchema: {
    type: 'object',
    properties: {
      memory_id: { type: 'string', description: 'ID of the memory to start from' },
      namespace: { type: 'string', description: 'Namespace to search in (defaults to default namespace)' },
      depth: { type: 'number', description: 'Graph traversal depth (default: 1)' },
    },
    required: ['memory_id'],
  },
  async handler(args, ctx) {
    const memoryId = str(args, 'memory_id');
    const namespace = optStr(args, 'namespace');
    const depth = optNum(args, 'depth', 1);

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Get the seed memory
    const seed = await store.getMemory(memoryId);
    if (!seed) {
      return { error: `Memory not found: ${memoryId}`, memory_id: memoryId };
    }

    // Traverse edges layer by layer up to depth
    const visited = new Set<string>([memoryId]);
    const layers: Array<{ depth: number; memory: ReturnType<typeof memoryToSummary>; edges: unknown[] }> = [
      { depth: 0, memory: memoryToSummary(seed), edges: [] },
    ];

    let frontier = [memoryId];
    for (let d = 0; d < depth; d++) {
      const edges = await store.getEdgesForMemories(frontier);
      const nextFrontier: string[] = [];

      for (const edge of edges) {
        const targetId = edge.source_id === frontier.find(id => id === edge.source_id)
          ? edge.target_id
          : edge.source_id;

        if (visited.has(targetId)) continue;
        visited.add(targetId);

        const neighbor = await store.getMemory(targetId);
        if (!neighbor) continue;

        layers.push({
          depth: d + 1,
          memory: memoryToSummary(neighbor),
          edges: edges
            .filter(e => e.source_id === memoryId || e.target_id === memoryId)
            .map(e => ({ relation: e.relation, weight: e.weight, evidence: e.evidence })),
        });
        nextFrontier.push(targetId);
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    return {
      seed_id: memoryId,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      depth,
      node_count: layers.length,
      nodes: layers,
    };
  },
};

const statsTool: ToolDefinition = {
  name: 'stats',
  description: 'Get memory statistics — total memories, unprocessed observations, namespace info, and active tools.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Namespace to inspect (defaults to default namespace)' },
    },
  },
  async handler(args, ctx) {
    const namespace = optStr(args, 'namespace');
    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Count memories
    const allMemories = await store.getAllMemories();
    const unprocessedObs = await store.getUnprocessedObservations(9999);

    // Namespace config
    const config = ctx.namespaces.getConfig(namespace);

    return {
      namespace: resolvedNs,
      namespaces: ctx.namespaces.getNamespaceNames(),
      default_namespace: ctx.namespaces.getDefaultNamespace(),
      memory_count: allMemories.length,
      unprocessed_observations: unprocessedObs.length,
      cognitive_tools: config.cognitive_tools,
      collections_prefix: config.collections_prefix,
    };
  },
};

const opsAppendTool: ToolDefinition = {
  name: 'ops_append',
  description: 'Log an operational breadcrumb — session notes, project milestones, decisions, or handoffs. Entries auto-expire after 30 days. Use the project parameter to group entries across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The operational log entry content' },
      type: { type: 'string', enum: ['log', 'instruction', 'handoff', 'milestone', 'decision'], description: 'Entry type (default: log)' },
      project: { type: 'string', description: 'Project name for per-project sub-logs' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['content'],
  },
  async handler(args, ctx) {
    const content = str(args, 'content');
    const type = (optStr(args, 'type') ?? 'log') as OpsEntryType;
    const project = optStr(args, 'project') ?? null;
    const namespace = optStr(args, 'namespace');

    const store: CortexStore = ctx.namespaces.getStore(namespace);
    const provenance = ctx.session.getProvenance();
    const keywords = extractKeywords(content);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const id = await store.appendOps({
      content,
      type,
      status: 'active',
      project,
      session_ref: provenance.model_id,
      keywords,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
      provenance,
    });

    return {
      id,
      type,
      project,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      keywords,
    };
  },
};

const opsQueryTool: ToolDefinition = {
  name: 'ops_query',
  description: 'Search the operational log. Filter by project, entry type, status, or time window. Use to review what happened in previous sessions or check project progress.',
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Filter by project name' },
      type: { type: 'string', enum: ['log', 'instruction', 'handoff', 'milestone', 'decision'], description: 'Filter by entry type' },
      status: { type: 'string', enum: ['active', 'done', 'stale'], description: 'Filter by status' },
      days: { type: 'number', description: 'Only show entries from last N days' },
      limit: { type: 'number', description: 'Max entries to return' },
      namespace: { type: 'string', description: 'Namespace to query' },
    },
  },
  async handler(args, ctx) {
    const namespace = optStr(args, 'namespace');
    const store: CortexStore = ctx.namespaces.getStore(namespace);

    const entries = await store.queryOps({
      project: optStr(args, 'project'),
      type: optStr(args, 'type') as OpsEntryType | undefined,
      status: optStr(args, 'status') as OpsStatus | undefined,
      days: args['days'] !== undefined ? optNum(args, 'days', 7) : undefined,
      limit: args['limit'] !== undefined ? optNum(args, 'limit', 20) : undefined,
    });

    return {
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      count: entries.length,
      entries: entries.map(e => ({
        id: e.id,
        content: e.content,
        type: e.type,
        status: e.status,
        project: e.project,
        keywords: e.keywords,
        created_at: e.created_at,
      })),
    };
  },
};

const opsUpdateTool: ToolDefinition = {
  name: 'ops_update',
  description: 'Update an operational log entry — change its status (active/done/stale) or amend its content.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the ops entry to update' },
      status: { type: 'string', enum: ['active', 'done', 'stale'], description: 'New status' },
      content: { type: 'string', description: 'Updated content' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['id'],
  },
  async handler(args, ctx) {
    const id = str(args, 'id');
    const namespace = optStr(args, 'namespace');
    const store: CortexStore = ctx.namespaces.getStore(namespace);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    const newStatus = optStr(args, 'status') as OpsStatus | undefined;
    const newContent = optStr(args, 'content');

    if (newStatus) updates['status'] = newStatus;
    if (newContent) {
      updates['content'] = newContent;
      updates['keywords'] = extractKeywords(newContent);
    }

    await store.updateOps(id, updates as Parameters<typeof store.updateOps>[1]);

    return {
      id,
      updated: true,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };
  },
};

// ─── Extended Tools ───────────────────────────────────────────────────────────

const predictTool: ToolDefinition = {
  name: 'predict',
  description: 'Anticipate what memories might be relevant given your current context. Unlike query() which answers a specific question, predict() surfaces knowledge you might need next. Returns results with confidence scores based on relevance and memory strength.',
  inputSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', description: 'Current context to predict from' },
      namespace: { type: 'string', description: 'Namespace to predict in (defaults to default namespace)' },
    },
    required: ['context'],
  },
  async handler(args, ctx) {
    const context = str(args, 'context');
    const namespace = optStr(args, 'namespace');

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // HyDE expand the context
    const expanded = await hydeExpand(context, ctx.llm, ctx.embed);

    // Find nearest memories
    const nearest = await store.findNearest(expanded, 5);

    const predictions = nearest.map(r => {
      const daysSince = elapsedDaysSince(r.memory.fsrs.last_review);
      const ret = retrievability(r.memory.fsrs.stability, daysSince);
      return {
        id: r.memory.id,
        name: r.memory.name,
        definition: r.memory.definition,
        category: r.memory.category,
        confidence: r.score * ret,
        similarity: r.score,
        retrievability: ret,
      };
    });

    return {
      context,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      count: predictions.length,
      predictions,
    };
  },
};

const validateTool: ToolDefinition = {
  name: 'validate',
  description: 'Confirm or deny a prediction. Correct predictions strengthen the memory (longer retention), incorrect ones weaken it (more frequent review). Use after predict() to close the feedback loop.',
  inputSchema: {
    type: 'object',
    properties: {
      prediction_id: { type: 'string', description: 'ID of the memory/prediction to validate' },
      outcome: { type: 'boolean', description: 'Whether the prediction was correct' },
      notes: { type: 'string', description: 'Optional notes on the validation outcome' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['prediction_id', 'outcome'],
  },
  async handler(args, ctx) {
    const predictionId = str(args, 'prediction_id');
    const outcome = args['outcome'] as boolean;
    const notes = optStr(args, 'notes') ?? '';
    const namespace = optStr(args, 'namespace');

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    const memory = await store.getMemory(predictionId);
    if (!memory) {
      return { error: `Memory not found: ${predictionId}`, prediction_id: predictionId };
    }

    // FSRS rating: correct=3 (Good), incorrect=1 (Again)
    const rating: 1 | 2 | 3 | 4 = outcome ? 3 : 1;
    const elapsed = elapsedDaysSince(memory.fsrs.last_review);
    const scheduled = scheduleNext(memory.fsrs, rating, elapsed);

    // Update memory FSRS state
    await store.touchMemory(predictionId, {
      stability: scheduled.stability,
      difficulty: scheduled.difficulty,
      state: scheduled.state,
      last_review: new Date(),
      reps: memory.fsrs.reps + 1,
      lapses: outcome ? memory.fsrs.lapses : memory.fsrs.lapses + 1,
    });

    const result = {
      prediction_id: predictionId,
      outcome,
      rating,
      notes,
      previous_stability: memory.fsrs.stability,
      new_stability: scheduled.stability,
      interval_days: scheduled.interval_days,
      state: scheduled.state,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };

    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'validate', notes, { prediction_id: predictionId, outcome }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'validate', result, ctx.allTools);

    return result;
  },
};

const believeTool: ToolDefinition = {
  name: 'believe',
  description: 'Update what you believe about an existing memory. Logs the previous definition, records why the belief changed, and updates the memory. Use when your understanding of a concept has changed — not for new observations.',
  inputSchema: {
    type: 'object',
    properties: {
      concept_id: { type: 'string', description: 'ID of the memory/concept being revised' },
      new_definition: { type: 'string', description: 'The updated definition or belief' },
      reason: { type: 'string', description: 'Why this belief is changing' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['concept_id', 'new_definition', 'reason'],
  },
  async handler(args, ctx) {
    const conceptId = str(args, 'concept_id');
    const newDefinition = str(args, 'new_definition');
    const reason = str(args, 'reason');
    const namespace = optStr(args, 'namespace');

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    const memory = await store.getMemory(conceptId);
    if (!memory) {
      return { error: `Memory not found: ${conceptId}`, concept_id: conceptId };
    }

    const oldDefinition = memory.definition;

    // Log belief change
    const beliefId = await store.putBelief({
      concept_id: conceptId,
      old_definition: oldDefinition,
      new_definition: newDefinition,
      reason,
      changed_at: new Date(),
    });

    // Re-embed with new definition
    const newEmbedding = await ctx.embed.embed(newDefinition);

    // Update the memory
    await store.updateMemory(conceptId, {
      definition: newDefinition,
      embedding: newEmbedding,
      updated_at: new Date(),
    });

    const result = {
      belief_id: beliefId,
      concept_id: conceptId,
      concept_name: memory.name,
      old_definition: oldDefinition,
      new_definition: newDefinition,
      reason,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };

    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();
    await fireTriggers(ctx, resolvedNs, 'believe', reason, { concept_id: conceptId, belief_id: beliefId }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'believe', result, ctx.allTools);

    return result;
  },
};

const reflectTool: ToolDefinition = {
  name: 'reflect',
  description: 'Synthesize what you know about a topic into a short reflective passage. Pulls related memories and generates a grounded reflection. The result is stored as a new observation for future retrieval.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Topic to reflect on' },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
    required: ['topic'],
  },
  async handler(args, ctx) {
    const topic = str(args, 'topic');
    const namespace = optStr(args, 'namespace');

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Query related memories
    const topicEmbedding = await ctx.embed.embed(topic);
    const related = await store.findNearest(topicEmbedding, 5);

    // Build context from related memories
    const memoryContext = related
      .map(r => `- ${r.memory.name}: ${r.memory.definition}`)
      .join('\n');

    // LLM generates reflection
    const reflection = await ctx.llm.generate(
      `You are reflecting on the topic: "${topic}"\n\nRelated concepts from memory:\n${memoryContext || '(no related memories found)'}\n\nWrite a 2-4 sentence reflection that synthesizes these concepts and your understanding of the topic. Be honest about uncertainty.`,
      {
        temperature: 0.7,
        maxTokens: 300,
        systemPrompt: 'You are a reflective cognitive agent. Generate thoughtful, grounded reflections based on the provided memory context.',
      },
    );

    // Store reflection as observation
    const embedding = await ctx.embed.embed(reflection);
    const keywords = extractKeywords(`${topic} ${reflection}`);
    const provenance = ctx.session.getProvenance();

    const obsId = await store.putObservation({
      content: reflection,
      source_file: '',
      source_section: `reflection:${topic}`,
      salience: 6,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      embedding,
      keywords,
      provenance,
    });

    return {
      topic,
      reflection,
      observation_id: obsId,
      related_memories: related.map(r => ({ id: r.memory.id, name: r.memory.name, score: r.score })),
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };
  },
};

const wanderTool: ToolDefinition = {
  name: 'wander',
  description: 'Take a random walk through your memories. Hops between connected concepts for serendipitous discovery. Use when you want inspiration or to explore what you know without a specific question.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Namespace to wander in (defaults to default namespace)' },
      steps: { type: 'number', description: 'Number of hops to take (default: 3)' },
    },
  },
  async handler(args, ctx) {
    const namespace = optStr(args, 'namespace');
    const steps = optNum(args, 'steps', 3);

    const store: CortexStore = ctx.namespaces.getStore(namespace);

    // Get all memories and pick a random seed
    const allMemories = await store.getAllMemories();
    if (allMemories.length === 0) {
      return { namespace: namespace ?? ctx.namespaces.getDefaultNamespace(), path: [], message: 'No memories to wander through' };
    }

    const seedMemory = allMemories[Math.floor(Math.random() * allMemories.length)];
    const path: Array<{ step: number; memory: ReturnType<typeof memoryToSummary>; relation?: string }> = [
      { step: 0, memory: memoryToSummary(seedMemory) },
    ];

    let currentId = seedMemory.id;

    for (let step = 1; step <= steps; step++) {
      const edges = await store.getEdgesFrom(currentId);
      if (edges.length === 0) break;

      // Pick a random edge weighted by edge weight
      const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);
      let rand = Math.random() * totalWeight;
      let chosenEdge = edges[0];
      for (const edge of edges) {
        rand -= edge.weight;
        if (rand <= 0) { chosenEdge = edge; break; }
      }

      const nextMemory = await store.getMemory(chosenEdge.target_id);
      if (!nextMemory) break;

      path.push({
        step,
        memory: memoryToSummary(nextMemory),
        relation: chosenEdge.relation,
      });
      currentId = chosenEdge.target_id;
    }

    return {
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      seed_id: seedMemory.id,
      steps_taken: path.length - 1,
      path,
    };
  },
};

const dreamTool: ToolDefinition = {
  name: 'dream',
  description: 'Run the memory consolidation cycle — a 7-phase process that turns observations into long-term memories. Phase 1: cluster observations to existing memories. Phase 2: refine memory definitions. Phase 3: create new memories from unclustered observations. Phase 4: discover connections between active memories. Phase 5: FSRS spaced-repetition review. Phase 6: cross-domain pattern synthesis. Phase 7: narrative summary. This is a heavyweight operation — run periodically (not every session), typically during maintenance or cron.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Namespace to consolidate (defaults to default namespace)' },
      limit: { type: 'number', description: 'Max observations to process in the cluster phase (default: 20)' },
    },
  },
  async handler(args, ctx) {
    const namespace = optStr(args, 'namespace');
    const limit = optNum(args, 'limit', 20);

    const store = ctx.namespaces.getStore(namespace);
    const nsConfig = ctx.namespaces.getConfig(namespace);

    const result = await dreamConsolidate(store, ctx.embed, ctx.llm, {
      observation_limit: limit,
      similarity_merge: nsConfig.similarity_merge,
      similarity_link: nsConfig.similarity_link,
    });

    return {
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
      ...result.phases,
      total_processed: result.total_processed,
      duration_ms: result.duration_ms,
      integration_rate: result.integration_rate,
    };
  },
};

const digestTool: ToolDefinition = {
  name: 'digest',
  description: 'Ingest a document — extracts facts as observations and generates reflections. Use for batch learning from files, plans, articles, or any content worth remembering.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The document content to digest (markdown, with or without frontmatter)' },
      source_file: { type: 'string', description: 'Source file path for provenance tracking' },
      pipeline: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pipeline steps to run (default: ["observe", "reflect"])',
      },
      namespace: { type: 'string', description: 'Target namespace (defaults to default)' },
      salience: { type: 'number', description: 'Salience override 0.0-1.0 (default: auto-detect)' },
    },
    required: ['content'],
  },
  async handler(args, ctx) {
    const content = str(args, 'content');
    const sourceFile = optStr(args, 'source_file');
    const namespace = optStr(args, 'namespace');
    const salience = args['salience'] !== undefined ? optNum(args, 'salience', 5) : undefined;
    const rawPipeline = args['pipeline'];
    const pipeline = Array.isArray(rawPipeline)
      ? (rawPipeline as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined;

    const store: CortexStore = ctx.namespaces.getStore(namespace);
    const resolvedNs = namespace ?? ctx.namespaces.getDefaultNamespace();

    const result = await digestDocument(content, store, ctx.embed, ctx.llm, {
      pipeline,
      namespace: resolvedNs,
      source_file: sourceFile,
      salience,
    });

    await fireTriggers(ctx, resolvedNs, 'observe', content, { observation_ids: result.observation_ids }, ctx.allTools);
    await fireBridges(ctx, resolvedNs, 'observe', { observation_ids: result.observation_ids, source_file: sourceFile }, ctx.allTools);

    return {
      namespace: resolvedNs,
      source_file: sourceFile ?? '',
      observation_ids: result.observation_ids,
      memories_linked: result.memories_linked,
      insights: result.insights,
      pipeline_executed: result.pipeline_executed,
      processed_at: result.processed_at.toISOString(),
      duration_ms: result.duration_ms,
    };
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/** All 17 cognitive tool definitions. */
export function createTools(): ToolDefinition[] {
  return [
    queryTool,
    observeTool,
    wonderTool,
    speculateTool,
    recallTool,
    neighborsTool,
    statsTool,
    opsAppendTool,
    opsQueryTool,
    opsUpdateTool,
    predictTool,
    validateTool,
    believeTool,
    reflectTool,
    wanderTool,
    dreamTool,
    digestTool,
  ];
}

/** Core tools that are always active regardless of namespace config. */
export const CORE_TOOLS = [
  'query',
  'observe',
  'wonder',
  'speculate',
  'recall',
  'neighbors',
  'stats',
  'ops_append',
  'ops_query',
  'ops_update',
] as const;
