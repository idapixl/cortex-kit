/**
 * MCP Server for cortex-engine.
 *
 * Wires providers, stores, namespaces, triggers, and bridges together
 * and exposes them as MCP tools over stdio.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CortexConfig } from '../core/config.js';
import { Session } from '../core/session.js';
import { NamespaceManager } from '../namespace/manager.js';
import { TriggerRegistry } from '../triggers/registry.js';
import { BridgeRegistry } from '../bridges/registry.js';
import { SqliteCortexStore } from '../stores/sqlite.js';
import { FirestoreCortexStore } from '../stores/firestore.js';
import { OllamaEmbedProvider, OllamaLLMProvider } from '../providers/ollama.js';
import type { EmbedProvider } from '../core/embed.js';
import type { LLMProvider } from '../core/llm.js';
import { createTools, CORE_TOOLS } from './tools.js';
import type { ToolContext } from './tools.js';
import { loadPlugins } from '../plugins/loader.js';

// ─── Server Factory ───────────────────────────────────────────────────────────

export async function createServer(config: CortexConfig): Promise<Server> {
  // 1. Create providers based on config (async — vertex uses dynamic imports)
  const embed = await createEmbedProvider(config);
  const llm = await createLLMProvider(config);

  // 2. Pre-initialize store backend (async for Firestore dynamic import)
  const firestoreInit = config.store === 'firestore'
    ? await initFirestoreDb(config)
    : null;

  // 3. Create namespace manager with store factory
  const namespaces = new NamespaceManager(config, (_namespace, prefix) => {
    if (config.store === 'sqlite') {
      return new SqliteCortexStore(
        config.store_options?.sqlite_path ?? './cortex.db',
        prefix,
      );
    }
    if (config.store === 'firestore') {
      return new FirestoreCortexStore(firestoreInit!.db, prefix, firestoreInit!.FieldValue);
    }
    throw new Error(`Unsupported store: ${config.store}`);
  });

  // 4. Create registries
  const triggers = new TriggerRegistry(config.namespaces);
  const bridges = new BridgeRegistry(config.bridges ?? []);

  // 5. Create session (auto-detect model)
  const detected = Session.detectModel();
  const provenanceConfig = config.model_provenance ?? {
    default_model: 'unknown',
    confidence_tiers: { high: [], medium: [], low: [] },
    conflict_policy: 'latest_wins' as const,
  };
  const session = new Session(
    detected.modelId,
    detected.modelFamily,
    detected.client,
    provenanceConfig.default_model,
    provenanceConfig,
  );

  // 6. Load plugins and merge with core tools
  const coreTools = createTools();
  const coreToolNames = new Set(coreTools.map(t => t.name));
  const pluginTools = await loadPlugins(config.plugins ?? [], coreToolNames);
  const allTools = [...coreTools, ...pluginTools];

  // 7. Build tool context (includes allTools for trigger/bridge pipelines)
  const ctx: ToolContext = { namespaces, embed, llm, session, triggers, bridges, allTools };

  // 8. Filter active tools by namespace config + core set
  const activeToolNames = namespaces.getActiveTools();
  for (const t of CORE_TOOLS) {
    activeToolNames.add(t);
  }
  // Plugin tools are always active (not gated by namespace config)
  for (const t of pluginTools) {
    activeToolNames.add(t.name);
  }
  const activeTools = allTools.filter(t => activeToolNames.has(t.name));

  // 9. Create MCP server
  const server = new Server(
    { name: 'cortex-engine', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: activeTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = activeTools.find(t => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args ?? {}, ctx);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error in tool "${name}": ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/** Start the MCP server using stdio transport. Called by bin/serve.ts. */
export async function startServer(config: CortexConfig): Promise<void> {
  const server = await createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── Provider Factories ───────────────────────────────────────────────────────

// Firestore DB init — lazy-loads firebase-admin via dynamic import() to avoid
// requiring the SDK when running in SQLite-only mode.
async function initFirestoreDb(config: CortexConfig): Promise<{
  db: import('@google-cloud/firestore').Firestore;
  FieldValue: typeof import('@google-cloud/firestore').FieldValue;
}> {
  const { getApps, initializeApp } = await import('firebase-admin/app');
  if (getApps().length === 0) {
    initializeApp({
      projectId: config.store_options?.gcp_project_id,
    });
  }
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const db = config.store_options?.firestore_database_id
    ? getFirestore(config.store_options.firestore_database_id)
    : getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  return { db, FieldValue };
}

async function createEmbedProvider(config: CortexConfig): Promise<EmbedProvider> {
  switch (config.embed) {
    case 'built-in': {
      const { BuiltInEmbedProvider } = await import('../providers/builtin-embed.js');
      return new BuiltInEmbedProvider();
    }
    case 'ollama':
      return new OllamaEmbedProvider({
        model: config.embed_options?.ollama_model,
        baseUrl: config.embed_options?.ollama_url,
      });
    case 'vertex': {
      const { PredictionServiceClient, helpers } = await import('@google-cloud/aiplatform');
      const { VertexEmbedProvider } = await import('../providers/vertex-embed.js');
      const location = config.embed_options?.vertex_location ?? 'us-central1';
      const client = new PredictionServiceClient({
        apiEndpoint: `${location}-aiplatform.googleapis.com`,
      });
      return new VertexEmbedProvider(
        {
          projectId: config.store_options?.gcp_project_id,
          location,
          model: config.embed_options?.vertex_model,
        },
        client,
        helpers,
      );
    }
    default:
      throw new Error(`Embed provider "${config.embed}" not yet implemented in this build`);
  }
}

async function createLLMProvider(config: CortexConfig): Promise<LLMProvider> {
  switch (config.llm) {
    case 'ollama':
      return new OllamaLLMProvider({
        model: config.llm_options?.ollama_model,
        baseUrl: config.llm_options?.ollama_url,
      });
    case 'gemini': {
      const { VertexAI } = await import('@google-cloud/vertexai');
      const { VertexLLMProvider } = await import('../providers/vertex-llm.js');
      const projectId = config.store_options?.gcp_project_id ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? '';
      const location = config.llm_options?.vertex_location ?? 'us-central1';
      const vertexAI = new VertexAI({ project: projectId, location });
      return new VertexLLMProvider(
        {
          projectId,
          location,
          model: config.llm_options?.gemini_model,
        },
        vertexAI,
      );
    }
    default:
      throw new Error(`LLM provider "${config.llm}" not yet implemented in this build`);
  }
}
