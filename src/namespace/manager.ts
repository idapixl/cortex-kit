/**
 * NamespaceManager — manages multiple cognitive namespaces from config.
 *
 * Each namespace gets its own CortexStore instance (via storeFactory) so typed
 * tables are fully isolated. ScopedStore wraps each instance to prefix generic
 * collection names, preventing cross-namespace collisions on arbitrary collections.
 */

import type { CortexConfig, NamespaceConfig } from '../core/config.js';
import type { CortexStore } from '../core/store.js';
import { ScopedStore } from './scoped-store.js';

export class NamespaceManager {
  private readonly namespaces: Map<string, ScopedStore>;
  private readonly defaultNamespace: string;
  private readonly configs: Map<string, NamespaceConfig>;

  constructor(
    config: CortexConfig,
    storeFactory: (namespace: string, prefix: string) => CortexStore,
  ) {
    this.namespaces = new Map();
    this.configs = new Map();

    let resolvedDefault: string | null = null;
    let firstNamespace: string | null = null;

    for (const [name, nsConfig] of Object.entries(config.namespaces)) {
      const store = storeFactory(name, nsConfig.collections_prefix);
      this.namespaces.set(name, new ScopedStore(store, nsConfig.collections_prefix));
      this.configs.set(name, nsConfig);

      if (firstNamespace === null) {
        firstNamespace = name;
      }
      if (nsConfig.default === true && resolvedDefault === null) {
        resolvedDefault = name;
      }
    }

    if (firstNamespace === null) {
      throw new Error('CortexConfig must define at least one namespace');
    }

    this.defaultNamespace = resolvedDefault ?? firstNamespace;
  }

  /** Get the scoped store for a namespace (defaults to the default namespace). */
  getStore(namespace?: string): CortexStore {
    const ns = namespace ?? this.defaultNamespace;
    const store = this.namespaces.get(ns);
    if (!store) throw new Error(`Unknown namespace: ${ns}`);
    return store;
  }

  /** Get the config for a namespace (defaults to the default namespace). */
  getConfig(namespace?: string): NamespaceConfig {
    const ns = namespace ?? this.defaultNamespace;
    const cfg = this.configs.get(ns);
    if (!cfg) throw new Error(`Unknown namespace: ${ns}`);
    return cfg;
  }

  /** Get the default namespace name. */
  getDefaultNamespace(): string {
    return this.defaultNamespace;
  }

  /** Get all namespace names. */
  getNamespaceNames(): string[] {
    return Array.from(this.namespaces.keys());
  }

  /** Get the union of all active cognitive tools across every namespace. */
  getActiveTools(): Set<string> {
    const tools = new Set<string>();
    for (const cfg of this.configs.values()) {
      for (const tool of cfg.cognitive_tools) {
        tools.add(tool);
      }
    }
    return tools;
  }

  /** Check whether a cognitive tool is active for a given namespace. */
  isToolActive(toolName: string, namespace?: string): boolean {
    return this.getConfig(namespace).cognitive_tools.includes(toolName);
  }
}
