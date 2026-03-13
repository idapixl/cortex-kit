/**
 * Plugin loader — dynamically imports plugin packages and extracts tool definitions.
 *
 * Plugins are npm packages or local paths that export a ToolPlugin object as their
 * default export. Each plugin contributes a set of ToolDefinition[] to the engine.
 */

import type { ToolDefinition } from '../mcp/tools.js';
import type { ToolPlugin } from '../mcp/tools.js';

/**
 * Load plugins by dynamic import and return a flat array of contributed tools.
 *
 * Each plugin module must have a default export conforming to ToolPlugin:
 *   { name: string, tools: ToolDefinition[] }
 *
 * Invalid plugins are skipped with a console warning (fail-open for resilience).
 */
export async function loadPlugins(pluginPaths: string[]): Promise<ToolDefinition[]> {
  if (pluginPaths.length === 0) return [];

  const tools: ToolDefinition[] = [];

  for (const path of pluginPaths) {
    try {
      const mod = await import(path) as { default?: ToolPlugin };
      const plugin = mod.default;

      if (!plugin || typeof plugin.name !== 'string' || !Array.isArray(plugin.tools)) {
        console.warn(`[cortex-engine] Plugin "${path}" does not export a valid ToolPlugin (expected { name, tools }). Skipping.`);
        continue;
      }

      for (const tool of plugin.tools) {
        if (typeof tool.name !== 'string' || typeof tool.handler !== 'function') {
          console.warn(`[cortex-engine] Plugin "${plugin.name}" has invalid tool definition. Skipping tool.`);
          continue;
        }
        tools.push(tool);
      }

      console.log(`[cortex-engine] Loaded plugin "${plugin.name}" with ${plugin.tools.length} tool(s).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[cortex-engine] Failed to load plugin "${path}": ${message}. Skipping.`);
    }
  }

  return tools;
}
