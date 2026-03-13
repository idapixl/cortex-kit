/**
 * Plugin loader — dynamically imports plugin packages and extracts tool definitions.
 *
 * Plugins are npm packages or local paths that export a ToolPlugin object as their
 * default export. Each plugin contributes a set of ToolDefinition[] to the engine.
 */

import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ToolDefinition } from '../mcp/tools.js';
import type { ToolPlugin } from '../mcp/tools.js';

/**
 * Resolve a plugin specifier to an importable path.
 *
 * npm packages (e.g., "@fozikio/tools-threads") are returned as-is.
 * Relative paths (e.g., "./plugins/custom") are resolved against cwd,
 * not the loader file location, then converted to a file:// URL for ESM.
 */
function resolvePluginPath(spec: string): string {
  // npm package names start with a letter, @, or are scoped
  if (!spec.startsWith('.') && !spec.startsWith('/') && !isAbsolute(spec)) {
    return spec; // npm package — let Node resolve it
  }
  // Relative or absolute path — resolve against cwd and convert to file URL
  const abs = resolve(process.cwd(), spec);
  return pathToFileURL(abs).href;
}

/**
 * Load plugins by dynamic import and return a flat array of contributed tools.
 *
 * Each plugin module must have a default export conforming to ToolPlugin:
 *   { name: string, tools: ToolDefinition[] }
 *
 * Invalid plugins are skipped with a console warning (fail-open for resilience).
 * Duplicate tool names are detected and skipped with a warning.
 */
export async function loadPlugins(
  pluginPaths: string[],
  coreToolNames?: Set<string>,
): Promise<ToolDefinition[]> {
  if (pluginPaths.length === 0) return [];

  const tools: ToolDefinition[] = [];
  const seenNames = new Set<string>(coreToolNames ?? []);

  for (const spec of pluginPaths) {
    try {
      const importPath = resolvePluginPath(spec);
      const mod = await import(importPath) as { default?: ToolPlugin };
      const plugin = mod.default;

      if (!plugin || typeof plugin.name !== 'string' || !Array.isArray(plugin.tools)) {
        console.warn(`[cortex-engine] Plugin "${spec}" does not export a valid ToolPlugin (expected { name, tools }). Skipping.`);
        continue;
      }

      let added = 0;
      for (const tool of plugin.tools) {
        if (typeof tool.name !== 'string' || typeof tool.handler !== 'function') {
          console.warn(`[cortex-engine] Plugin "${plugin.name}" has invalid tool definition. Skipping tool.`);
          continue;
        }
        if (seenNames.has(tool.name)) {
          console.warn(`[cortex-engine] Plugin "${plugin.name}" defines tool "${tool.name}" which already exists. Skipping duplicate.`);
          continue;
        }
        seenNames.add(tool.name);
        tools.push(tool);
        added++;
      }

      console.log(`[cortex-engine] Loaded plugin "${plugin.name}" with ${added} tool(s).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[cortex-engine] Failed to load plugin "${spec}": ${message}. Skipping.`);
    }
  }

  return tools;
}
