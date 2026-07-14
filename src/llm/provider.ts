import fetch from 'node-fetch';
import logger from '../utils/logger';

/**
 * Cloud LLM providers (Anthropic / OpenAI) for the owner Q&A layer. These are
 * strictly additive on top of the local Ollama pipeline: they only ever get
 * read-only query tools, never mutation paths — parsing and schedule changes
 * remain deterministic (see src/business/groupUpdates.ts).
 */

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  /** One model turn. The caller runs the tool loop. */
  chat(system: string, messages: ChatMessage[], tools: ChatTool[]): Promise<ChatResult>;
}

const DEFAULT_TIMEOUT_MS = 45000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${url} → HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---- Anthropic ------------------------------------------------------------------

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(
    private apiKey: string,
    private model: string = 'claude-sonnet-4-5',
    private baseUrl: string = 'https://api.anthropic.com'
  ) {}

  async chat(system: string, messages: ChatMessage[], tools: ChatTool[]): Promise<ChatResult> {
    const apiMessages = messages.map(message => {
      if (message.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]
        };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const blocks: AnthropicContentBlock[] = [];
        if (message.content) blocks.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        }
        return { role: 'assistant' as const, content: blocks };
      }
      return { role: message.role, content: message.content };
    });

    const data = await postJson(`${this.baseUrl}/v1/messages`, {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01'
    }, {
      model: this.model,
      max_tokens: 1024,
      system,
      messages: apiMessages,
      ...(tools.length > 0
        ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
        : {})
    }) as { content: AnthropicContentBlock[] };

    const result: ChatResult = { text: '', toolCalls: [] };
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) result.text += block.text;
      if (block.type === 'tool_use' && block.id && block.name) {
        result.toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }
    return result;
  }
}

// ---- OpenAI ---------------------------------------------------------------------

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  constructor(
    private apiKey: string,
    private model: string = 'gpt-4o-mini',
    private baseUrl: string = 'https://api.openai.com'
  ) {}

  async chat(system: string, messages: ChatMessage[], tools: ChatTool[]): Promise<ChatResult> {
    const apiMessages: unknown[] = [{ role: 'system', content: system }];
    for (const message of messages) {
      if (message.role === 'tool') {
        apiMessages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      } else if (message.role === 'assistant' && message.toolCalls?.length) {
        apiMessages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.input) }
          }))
        });
      } else {
        apiMessages.push({ role: message.role, content: message.content });
      }
    }

    const data = await postJson(`${this.baseUrl}/v1/chat/completions`, {
      Authorization: `Bearer ${this.apiKey}`
    }, {
      model: this.model,
      messages: apiMessages,
      ...(tools.length > 0
        ? {
          tools: tools.map(tool => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
          }))
        }
        : {})
    }) as { choices: Array<{ message: { content: string | null; tool_calls?: OpenAIToolCall[] } }> };

    const choice = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (choice?.tool_calls ?? []).map(call => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        logger.warn({ arguments: call.function.arguments }, 'OpenAI tool arguments were not valid JSON');
      }
      return { id: call.id, name: call.function.name, input };
    });
    return { text: choice?.content ?? '', toolCalls };
  }
}

// ---- Factory --------------------------------------------------------------------

/**
 * Build the configured cloud provider from the environment, or null when none
 * is configured — callers then stay on the local Ollama/deterministic chain.
 *
 *   LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY [+ ANTHROPIC_MODEL]
 *   LLM_PROVIDER=openai    + OPENAI_API_KEY    [+ OPENAI_MODEL]
 */
export function createCloudProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider | null {
  const which = (env.LLM_PROVIDER || '').toLowerCase();
  if (which === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      logger.warn('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing — cloud Q&A disabled');
      return null;
    }
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || undefined);
  }
  if (which === 'openai') {
    if (!env.OPENAI_API_KEY) {
      logger.warn('LLM_PROVIDER=openai but OPENAI_API_KEY is missing — cloud Q&A disabled');
      return null;
    }
    return new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || undefined);
  }
  return null;
}
