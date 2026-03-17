/**
 * REST API server for cortex-engine.
 *
 * Lightweight HTTP layer on top of the same ToolContext used by the MCP server.
 * Uses Node's built-in http module — zero additional dependencies.
 *
 * Routes map directly to cortex tool handlers, so the REST API always stays
 * in sync with MCP capabilities. Any plugin tools are also exposed.
 *
 * Usage:
 *   fozikio serve --rest --port 3000
 *   cortex-engine --rest --port 3000
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineContext } from '../mcp/server.js';
import type { ToolDefinition } from '../mcp/tools.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  engine: EngineContext,
) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

// ─── Route Helpers ────────────────────────────────────────────────────────────

const routes: Route[] = [];

function route(method: string, path: string, handler: RouteHandler): void {
  const paramNames: string[] = [];
  const pattern = path.replace(/:([^/]+)/g, (_match, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    method,
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
    handler,
  });
}

function matchRoute(method: string, pathname: string): RouteMatch | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
      return { handler: r.handler, params };
    }
  }
  return null;
}

// ─── Request Helpers ──────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function errorJson(res: ServerResponse, message: string, status: number): void {
  json(res, { error: message }, status);
}

// ─── FSRS Helper ─────────────────────────────────────────────────────────────

/** Estimate retrievability from FSRS stability and last review time. */
function retrievabilityFromFsrs(fsrs?: { stability: number; last_review: Date | null }): number {
  if (!fsrs || !fsrs.last_review) return 0;
  const elapsed = (Date.now() - new Date(fsrs.last_review).getTime()) / 86400000; // days
  return Math.pow(0.9, elapsed / fsrs.stability);
}

// ─── Tool Invocation Helper ──────────────────────────────────────────────────

async function invokeTool(
  engine: EngineContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = engine.activeTools.find((t: ToolDefinition) => t.name === toolName);
  if (!tool) {
    throw new Error(`Tool "${toolName}" not available`);
  }
  return tool.handler(args, engine.ctx);
}

// ─── Route Definitions ───────────────────────────────────────────────────────

// Health check — no auth required, always first
route('GET', '/health', async (_req, res, _params, engine) => {
  json(res, {
    status: 'ok',
    version: getVersion(),
    store: engine.config.store,
    tools: engine.activeTools.length,
  });
});

// Stats
route('GET', '/api/stats', async (_req, res, _params, engine) => {
  const result = await invokeTool(engine, 'stats', {});
  json(res, result);
});

// Search / Query
route('GET', '/api/search', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const q = url.searchParams.get('q') ?? '';
  const topK = url.searchParams.get('top_k');
  if (!q) return errorJson(res, 'Missing required query parameter: q', 400);
  const args: Record<string, unknown> = { query: q };
  if (topK) args['top_k'] = parseInt(topK, 10);
  const result = await invokeTool(engine, 'query', args);
  // Reshape to match dashboard expectations
  const memories = (result as Record<string, unknown>)['memories'] as Array<Record<string, unknown>> | undefined;
  json(res, {
    results: (memories ?? []).map(m => ({
      id: m['id'],
      name: m['name'] ?? m['content'],
      definition: m['definition'] ?? m['content'] ?? '',
      score: m['score'] ?? m['similarity'] ?? 0,
      category: m['category'],
      salience: m['salience'],
    })),
  });
});

// Recall (natural language memory recall)
route('GET', '/api/recall', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const q = url.searchParams.get('q') ?? '';
  if (!q) return errorJson(res, 'Missing required query parameter: q', 400);
  const result = await invokeTool(engine, 'recall', { question: q });
  json(res, result);
});

// Observe (write a new observation/memory)
route('POST', '/api/observe', async (req, res, _params, engine) => {
  const body = await readBody(req);
  if (!body['content']) return errorJson(res, 'Missing required field: content', 400);
  const result = await invokeTool(engine, 'observe', body);
  json(res, result, 201);
});

// Graph neighbors
route('POST', '/api/v2/graph/neighbors', async (req, res, _params, engine) => {
  const body = await readBody(req);
  const conceptId = body['concept_id'] as string | undefined;
  if (!conceptId) return errorJson(res, 'Missing required field: concept_id', 400);
  const result = await invokeTool(engine, 'neighbors', { id: conceptId });
  // Reshape for dashboard
  const edges = (result as Record<string, unknown>)['neighbors'] as Array<Record<string, unknown>> | undefined;
  json(res, { neighbors: edges ?? [] });
});

// Dream (consolidation)
route('POST', '/api/dream', async (req, res, _params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'dream', body);
  json(res, result);
});

// Vitals
route('GET', '/api/vitals', async (_req, res, _params, engine) => {
  const result = await invokeTool(engine, 'vitals_get', {});
  json(res, result);
});

// Coherence
route('GET', '/api/coherence', async (_req, res, _params, engine) => {
  const result = await invokeTool(engine, 'validate', {});
  json(res, result);
});

// Home (aggregate)
route('GET', '/api/home', async (_req, res, _params, engine) => {
  // Compose home data from multiple tools
  const [stats, vitals] = await Promise.allSettled([
    invokeTool(engine, 'stats', {}),
    invokeTool(engine, 'vitals_get', {}),
  ]);

  json(res, {
    stats: stats.status === 'fulfilled' ? stats.value : null,
    vitals: vitals.status === 'fulfilled' ? vitals.value : null,
    recent_observations: [],
  });
});

// ── Memories ──────────────────────────────────────────────────────────────────

route('GET', '/api/memories', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  // Use the namespace manager to get the default store
  const store = engine.ctx.namespaces.getStore();
  const allMemories = await store.getAllMemories();

  const memories = allMemories
    .slice(offset, offset + limit)
    .map(m => ({
      id: m.id,
      content: m.name ?? '',
      nodeType: m.category ?? 'memory',
      tags: m.tags ?? [],
      retentionStrength: m.fsrs?.stability ?? 0,
      storageStrength: m.fsrs?.stability ?? 0,
      retrievalStrength: retrievabilityFromFsrs(m.fsrs),
      createdAt: m.created_at?.toISOString?.() ?? new Date().toISOString(),
      updatedAt: m.updated_at?.toISOString?.() ?? m.created_at?.toISOString?.() ?? new Date().toISOString(),
      source: m.provenance?.model_id,
      combinedScore: retrievabilityFromFsrs(m.fsrs),
    }));

  json(res, { memories });
});

// ── Ops ───────────────────────────────────────────────────────────────────────

route('GET', '/api/v2/ops', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const query = parseQuery(url);
  const result = await invokeTool(engine, 'ops_query', query);
  json(res, result);
});

route('POST', '/api/v2/ops', async (req, res, _params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'ops_append', body);
  json(res, result, 201);
});

route('PATCH', '/api/v2/ops/:id', async (req, res, params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'ops_update', { id: params['id'], ...body });
  json(res, result);
});

// ── Threads ───────────────────────────────────────────────────────────────────

route('GET', '/api/v2/threads', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const query = parseQuery(url);
  const result = await invokeTool(engine, 'threads_list', query);
  json(res, result);
});

route('POST', '/api/v2/threads', async (req, res, _params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'thread_create', body);
  json(res, result, 201);
});

route('GET', '/api/v2/threads/:id', async (_req, res, params, engine) => {
  const result = await invokeTool(engine, 'threads_list', { id: params['id'] });
  json(res, result);
});

route('PUT', '/api/v2/threads/:id', async (req, res, params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'thread_update', { id: params['id'], ...body });
  json(res, result);
});

route('PUT', '/api/v2/threads/:id/resolve', async (req, res, params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'thread_resolve', {
    id: params['id'],
    resolution: (body['resolution'] as string) ?? '',
  });
  json(res, result);
});

// ── Content ───────────────────────────────────────────────────────────────────

route('GET', '/api/v2/content', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const query = parseQuery(url);
  const result = await invokeTool(engine, 'content_list', query);
  json(res, result);
});

route('GET', '/api/v2/content/:id', async (_req, res, params, engine) => {
  const result = await invokeTool(engine, 'content_list', { id: params['id'] });
  json(res, result);
});

route('PUT', '/api/v2/content/:id', async (req, res, params, engine) => {
  const body = await readBody(req);
  const result = await invokeTool(engine, 'content_update', { id: params['id'], ...body });
  json(res, result);
});

// ── Retrieval feedback audit ──────────────────────────────────────────────────

route('GET', '/api/v2/retrieval-feedback/audit', async (req, res, _params, engine) => {
  const url = new URL(req.url!, `http://localhost`);
  const days = url.searchParams.get('days');
  const args: Record<string, unknown> = {};
  if (days) args['days'] = parseInt(days, 10);
  try {
    const result = await invokeTool(engine, 'retrieval_audit', args);
    json(res, result);
  } catch {
    // Tool may not be available — return empty
    json(res, { queries: [], accuracy: 0, total: 0 });
  }
});

// ── Generic tool invocation (escape hatch) ────────────────────────────────────

route('POST', '/api/tools/:name', async (req, res, params, engine) => {
  const toolName = params['name'];
  const body = await readBody(req);
  const result = await invokeTool(engine, toolName, body);
  json(res, result);
});

// ── List available tools ──────────────────────────────────────────────────────

route('GET', '/api/tools', async (_req, res, _params, engine) => {
  json(res, {
    tools: engine.activeTools.map(t => ({
      name: t.name,
      description: t.description,
    })),
  });
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true; // No token configured = open access
  const header = req.headers['x-cortex-token']
    ?? req.headers['x-marty-token']
    ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  return header === token;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function setCorsHeaders(res: ServerResponse, origin?: string): void {
  // Allow any localhost origin (dashboard runs on arbitrary ports)
  const allowed = origin && /^http:\/\/localhost:\d+$/.test(origin) ? origin : '';
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cortex-token, x-marty-token, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

// ─── Version ──────────────────────────────────────────────────────────────────

function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── Dashboard (static file serving) ─────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Resolve the dashboard public/ directory (bundled alongside dist/) */
function getDashboardDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dist/rest/server.js → public is at ../../public
  return join(here, '..', '..', 'public');
}

/** Try to serve a static file. Returns true if served, false if not found. */
function serveStatic(res: ServerResponse, pathname: string, dashboardDir: string): boolean {
  // Prevent directory traversal
  const safePath = pathname.replace(/\.\./g, '').replace(/\/\//g, '/');
  const filePath = join(dashboardDir, safePath);

  // Must be within dashboardDir
  if (!filePath.startsWith(dashboardDir)) return false;

  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export interface RestServerOptions {
  port?: number;
  token?: string;
  /** Optional CORS origin override (default: localhost only) */
  corsOrigin?: string | RegExp;
}

/**
 * Start the REST API server for cortex-engine.
 *
 * Reuses the same EngineContext that powers the MCP server,
 * so tool behavior is identical across both transports.
 */
export async function startRestServer(
  engine: EngineContext,
  options: RestServerOptions = {},
): Promise<void> {
  const port = options.port ?? 3000;
  const token = options.token ?? process.env['CORTEX_API_TOKEN'] ?? process.env['MARTY_API_TOKEN'];

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const method = req.method ?? 'GET';
    const origin = req.headers['origin'] as string | undefined;

    // CORS headers on every response
    setCorsHeaders(res, origin);

    // Preflight
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Dashboard static files (no auth required — dashboard handles auth via API calls)
    const dashboardDir = getDashboardDir();
    const hasDashboard = existsSync(join(dashboardDir, 'index.html'));

    if (method === 'GET' && hasDashboard && !url.pathname.startsWith('/api/') && url.pathname !== '/health') {
      if (serveStatic(res, url.pathname, dashboardDir)) return;
      // SPA fallback — serve index.html for client-side routes
      if (!extname(url.pathname)) {
        if (serveStatic(res, '/index.html', dashboardDir)) return;
      }
    }

    // Auth check (skip for /health and dashboard assets)
    if (url.pathname !== '/health' && !checkAuth(req, token)) {
      errorJson(res, 'Unauthorized', 401);
      return;
    }

    // Route matching
    const match = matchRoute(method, url.pathname);
    if (!match) {
      errorJson(res, `Not found: ${method} ${url.pathname}`, 404);
      return;
    }

    try {
      await match.handler(req, res, match.params, engine);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not available')) {
        errorJson(res, message, 404);
      } else {
        errorJson(res, message, 500);
      }
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const log = (s: string) => process.stderr.write(s + '\n');
      log(`  rest api ready · http://localhost:${port}`);
      log(`  ${engine.activeTools.length} tools · ${token ? 'auth enabled' : 'no auth'}`);
      if (existsSync(join(getDashboardDir(), 'index.html'))) {
        log(`  dashboard · http://localhost:${port}`);
      }
      log('');
      resolve();
    });
  });
}
