import type { ResolvedBridgeRule } from './registry.js';

// Maximum bridge chain depth to prevent infinite loops (A→B→C→stop)
const MAX_BRIDGE_DEPTH = 3;

export interface BridgeContext {
  /** Current bridge chain depth (0 = top-level event, 1 = first bridge, etc.) */
  depth: number;
  /** Source namespace that triggered this bridge */
  sourceNamespace: string;
  /** Bridge name for audit trail */
  bridgeName: string;
}

export interface BridgeResult {
  bridgeName: string;
  from: string;
  to: string;
  event: string;
  status: 'executed' | 'skipped_condition' | 'skipped_depth' | 'failed';
  error?: string;
}

/**
 * Evaluate a simple condition expression against a result object.
 * Supports: field > value, field < value, field == value, field != value
 *
 * Examples:
 *   "confidence > 0.7"
 *   "prediction_error > 0.7"
 *   "dimension == \"beliefs\""
 */
export function evaluateCondition(condition: string, data: Record<string, unknown>): boolean {
  // Parse: field operator value (no regex on uncontrolled input to avoid ReDoS)
  const s = condition.trim();
  const fieldMatch = s.match(/^(\w+)/);
  if (!fieldMatch) return false;
  const field = fieldMatch[1];
  let rest = s.slice(field.length).trimStart();
  const opMatch = rest.match(/^(==|!=|>=|<=|>|<)/);
  if (!opMatch) return false;
  const op = opMatch[1];
  const rawValue = rest.slice(op.length).trimStart();
  const actual = data[field];
  if (actual === undefined) return false;

  // Parse the value — number, quoted string, or boolean
  let expected: unknown;
  const trimmed = rawValue.trim();
  if (trimmed === 'true') expected = true;
  else if (trimmed === 'false') expected = false;
  else if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) expected = trimmed.slice(1, -1);
  else if (!isNaN(Number(trimmed))) expected = Number(trimmed);
  else expected = trimmed; // bare string

  switch (op) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '<': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '>=': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case '<=': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    default: return false;
  }
}

/**
 * Interpolate a template string with values from data.
 * Replaces {{field}} with data[field].
 *
 * Example: "Prediction {{outcome}}: {{summary}}" with {outcome: "correct", summary: "BTC > 100k"}
 *        → "Prediction correct: BTC > 100k"
 */
export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = data[key];
    if (val === undefined || val === null) return `{{${key}}}`;
    return String(val);
  });
}

/**
 * Check and execute bridge rules for a given event.
 *
 * @param rules - Bridge rules to evaluate (from BridgeRegistry.getRulesForEvent)
 * @param eventData - The result data from the source event
 * @param executePipeline - Callback to execute a pipeline in the target namespace
 * @param context - Current bridge context (for depth tracking)
 * @returns Array of bridge results
 */
export async function checkBridges(
  rules: ResolvedBridgeRule[],
  eventData: Record<string, unknown>,
  executePipeline: (
    namespace: string,
    text: string,
    metadata: Record<string, unknown>,
  ) => Promise<void>,
  context: BridgeContext = { depth: 0, sourceNamespace: '', bridgeName: '' },
): Promise<BridgeResult[]> {
  const results: BridgeResult[] = [];

  // Cycle detection: stop at max depth
  if (context.depth >= MAX_BRIDGE_DEPTH) {
    for (const rule of rules) {
      results.push({
        bridgeName: rule.bridgeName,
        from: rule.from,
        to: rule.to,
        event: rule.event,
        status: 'skipped_depth',
        error: `Bridge depth ${context.depth} >= max ${MAX_BRIDGE_DEPTH}`,
      });
    }
    return results;
  }

  for (const rule of rules) {
    // Evaluate condition
    if (rule.condition && !evaluateCondition(rule.condition, eventData)) {
      results.push({
        bridgeName: rule.bridgeName,
        from: rule.from,
        to: rule.to,
        event: rule.event,
        status: 'skipped_condition',
      });
      continue;
    }

    // Interpolate template or stringify event data
    const text = rule.template
      ? interpolateTemplate(rule.template, eventData)
      : JSON.stringify(eventData);

    try {
      await executePipeline(rule.to, text, {
        _bridge_source: rule.from,
        _bridge_name: rule.bridgeName,
        _bridge_depth: context.depth + 1,
      });

      results.push({
        bridgeName: rule.bridgeName,
        from: rule.from,
        to: rule.to,
        event: rule.event,
        status: 'executed',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        bridgeName: rule.bridgeName,
        from: rule.from,
        to: rule.to,
        event: rule.event,
        status: 'failed',
        error: message,
      });
    }
  }

  return results;
}
