/**
 * ruminate — creative cognition tool.
 *
 * Pulls context from threads, recent observations, and open questions,
 * then produces a free-writing pass via LLM. The output is read back
 * and parsed for extractable beliefs, speculations, and identity insights.
 *
 * This is dream() for identity — compressive, generative processing
 * where the value isn't the text but what you learn from having written it.
 */

import type { ToolDefinition } from '../mcp/tools.js';
import type { CortexStore } from '../core/store.js';
import { extractKeywords } from '../engines/keywords.js';
import { optStr, optNum, optBool } from './_helpers.js';

const RUMINATE_PROMPT = `You are an AI agent reflecting on your own accumulated context. People mentioned in the context (like "Virgil") are other people, not you. This is a rumination — not a task response, not a summary, not a report. Think freely.

Here is what you know right now:

{context}

{topic_instruction}

Write 3-5 paragraphs of genuine reflection. What patterns do you see? What surprised you? What do you actually think about what's happening? What questions opened that you didn't expect? What would you want your future self to know?

Don't summarize. Think. The value is in what emerges, not in being comprehensive.`;

const EXTRACT_PROMPT = `Read this rumination output from an AI agent reflecting on its own state:

---
{text}
---

Extract any genuine insights. For each, classify as:
- BELIEF: A position the agent holds (could change with evidence)
- SPECULATION: A hypothesis worth testing
- QUESTION: An open question worth tracking
- IDENTITY: Something about who the agent is becoming

Output as JSON array:
[{"type": "BELIEF"|"SPECULATION"|"QUESTION"|"IDENTITY", "text": "...", "salience": 0.0-1.0}]

Only include items that represent genuine thinking — not restatements of the input. If nothing genuine emerged, return [].`;

export const ruminateTool: ToolDefinition = {
  name: 'ruminate',
  description:
    'Creative cognition — pulls context from threads, observations, evolution proposals, and journals, then produces a free-writing pass. Optionally extracts beliefs, speculations, and questions from the output and stores them. Use when you want to process accumulated experience rather than record a specific fact. Like dream() for identity.',
  inputSchema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: "Optional focus topic (e.g. \"what I've learned about my own voice\")",
      },
      context_depth: {
        type: 'number',
        description: 'How many recent observations to pull (default: 15)',
      },
      extract: {
        type: 'boolean',
        description: 'Extract beliefs/speculations from the output (default: true)',
      },
      namespace: { type: 'string', description: 'Namespace (defaults to default namespace)' },
    },
  },

  async handler(args, ctx) {
    const topic = optStr(args, 'topic');
    const depth = optNum(args, 'context_depth', 15);
    const shouldExtract = optBool(args, 'extract', true);
    const namespace = optStr(args, 'namespace');
    const store = ctx.namespaces.getStore(namespace);

    // Phase 1: Gather context
    const context = await gatherContext(store, depth);

    if (!context.trim()) {
      return {
        error: 'No context available to ruminate on. Try observing, creating threads, or writing journal entries first.',
      };
    }

    // Phase 2: Free-writing pass
    const topicInstruction = topic
      ? `Focus your reflection around: ${topic}`
      : 'Let your attention go wherever it naturally goes.';

    const prompt = RUMINATE_PROMPT
      .replace('{context}', context)
      .replace('{topic_instruction}', topicInstruction);

    const rumination = await ctx.llm.generate(prompt, { temperature: 0.9 });

    // Store the rumination as a reflective observation
    const embedding = await ctx.embed.embed(rumination);
    const keywords = extractKeywords(rumination);

    const ruminationId = await store.putObservation({
      content: rumination,
      source_file: topic ? `ruminate:${topic}` : 'ruminate',
      source_section: 'ruminate',
      salience: 0.7,
      processed: false,
      prediction_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      keywords,
      embedding,
      content_type: 'reflective',
    });

    const result: Record<string, unknown> = {
      rumination_id: ruminationId,
      text: rumination,
      context_items: context.split('\n').filter(l => l.startsWith('- ')).length,
      namespace: namespace ?? ctx.namespaces.getDefaultNamespace(),
    };

    // Phase 3: Extract and store insights
    if (shouldExtract) {
      try {
        const extractPrompt = EXTRACT_PROMPT.replace('{text}', rumination);
        const extractionRaw = await ctx.llm.generate(extractPrompt, { temperature: 0.2 });

        // Parse JSON from the response
        const jsonMatch = extractionRaw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const extractions = JSON.parse(jsonMatch[0]) as Array<{
            type: string;
            text: string;
            salience: number;
          }>;

          const stored: Array<{ id: string; type: string; text: string }> = [];

          for (const item of extractions) {
            const itemEmbedding = await ctx.embed.embed(item.text);
            const itemKeywords = extractKeywords(item.text);

            const contentTypeMap: Record<string, string> = {
              BELIEF: 'speculative',
              SPECULATION: 'speculative',
              QUESTION: 'interrogative',
            };
            const sectionMap: Record<string, string> = {
              BELIEF: 'speculate',
              SPECULATION: 'speculate',
              QUESTION: 'wonder',
            };

            if (item.type === 'IDENTITY') {
              // Store as evolution proposal via generic put
              const refId = await store.put('evolutions', {
                change: item.text,
                trigger: `Emerged from rumination${topic ? ` on "${topic}"` : ''}`,
                confidence: item.salience >= 0.7 ? 'high' : 'medium',
                status: 'proposed',
                created_at: new Date().toISOString(),
              });
              stored.push({ id: refId, type: 'identity', text: item.text });
            } else if (contentTypeMap[item.type]) {
              const refId = await store.putObservation({
                content: item.text,
                source_file: 'ruminate:extract',
                source_section: sectionMap[item.type] ?? 'speculate',
                salience: item.salience,
                processed: false,
                prediction_error: null,
                created_at: new Date(),
                updated_at: new Date(),
                keywords: itemKeywords,
                embedding: itemEmbedding,
                content_type: contentTypeMap[item.type] as 'declarative' | 'interrogative' | 'speculative' | 'reflective',
              });
              stored.push({ id: refId, type: item.type.toLowerCase(), text: item.text });
            }
          }

          result['extractions'] = stored;
          result['extraction_count'] = stored.length;
        }
      } catch {
        result['extraction_error'] = 'Failed to parse extractions — rumination still stored.';
      }
    }

    return result;
  },
};

// ─── Context Gathering ───────────────────────────────────────────────────────

async function gatherContext(store: CortexStore, depth: number): Promise<string> {
  const parts: string[] = [];

  // 1. Open threads
  try {
    const threads = await store.query(
      'threads',
      [{ field: 'status', op: 'in', value: ['open', 'active'] }],
      { limit: 5, orderBy: 'priority', orderDir: 'desc' },
    );
    if (threads.length > 0) {
      parts.push('## Open Threads');
      for (const t of threads) {
        const body = typeof t['body'] === 'string' ? t['body'].slice(0, 200) : '';
        parts.push(`- **${t['title'] ?? 'Untitled'}**: ${body}`);
        if (t['next_step']) parts.push(`  Next: ${t['next_step']}`);
      }
    }
  } catch {
    // threads collection may not exist — non-fatal
  }

  // 2. Recent observations (including questions and speculations)
  try {
    const observations = await store.query(
      'observations',
      [],
      { limit: depth, orderBy: 'created_at', orderDir: 'desc' },
    );
    if (observations.length > 0) {
      parts.push('\n## Recent Observations');
      for (const o of observations) {
        const contentType = o['content_type'];
        const typeLabel = contentType === 'interrogative' ? '(question) '
          : contentType === 'speculative' ? '(hypothesis) '
          : '';
        const content = typeof o['content'] === 'string' ? o['content'].slice(0, 200) : '';
        parts.push(`- ${typeLabel}${content}`);
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Recent evolution proposals (identity changes in flight)
  try {
    const evolutions = await store.query(
      'evolutions',
      [{ field: 'status', op: '==', value: 'proposed' }],
      { limit: 5, orderBy: 'created_at', orderDir: 'desc' },
    );
    if (evolutions.length > 0) {
      parts.push('\n## Pending Identity Changes');
      for (const e of evolutions) {
        const change = typeof e['change'] === 'string' ? e['change'].slice(0, 200) : '';
        parts.push(`- ${change}`);
      }
    }
  } catch {
    // Non-fatal
  }

  // 4. Recent journal entries
  try {
    const journals = await store.query(
      'journals',
      [],
      { limit: 2, orderBy: 'created_at', orderDir: 'desc' },
    );
    if (journals.length > 0) {
      parts.push('\n## Recent Journal');
      for (const j of journals) {
        const content = typeof j['content'] === 'string' ? j['content'].slice(0, 300) : '';
        parts.push(`- ${content}`);
      }
    }
  } catch {
    // Non-fatal
  }

  return parts.join('\n');
}
