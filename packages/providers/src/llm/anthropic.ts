import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, LlmRequest, LlmStructuredResult, LlmTextResult, LLMProvider, ModelClass, StructuredLlmRequest } from '../core/interfaces.js';

/** Model class → model (docs/12 §59). Fast/extraction work on the small model, reasoning on the strongest. */
export const ANTHROPIC_MODELS: Record<ModelClass, string> = {
  FAST: 'claude-haiku-4-5-20251001',
  EXTRACTION: 'claude-haiku-4-5-20251001',
  STANDARD: 'claude-sonnet-5-5',
  REASONING: 'claude-opus-5-5',
};

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  models?: Partial<Record<ModelClass, string>>;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

interface MessagesResponse {
  model: string;
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown })[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

/**
 * Anthropic Claude behind the LLMProvider interface (docs/12 §57-64). Structured output is forced through a single tool
 * whose input schema is the expected JSON Schema, then validated again with the caller's schema — a model answer that
 * does not fit is an error, never passed on. Token usage is reported; cost stays unknown rather than guessed.
 * No side effects: a failed call may be retried.
 */
export class AnthropicProvider implements LLMProvider {
  readonly key = 'anthropic';
  private readonly baseUrl: string;
  private readonly models: Record<ModelClass, string>;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: AnthropicOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.models = { ...ANTHROPIC_MODELS, ...options.models };
    this.doFetch = options.fetch ?? fetch;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    // Side-effect free and free of charge: a key is configured. Real reachability shows up in call outcomes.
    const ok = !!this.options.apiKey;
    const detail = ok ? 'API key configured on the server' : 'No LLM_API_KEY on the server';
    return [
      { capability: 'LLM_REASONING', ok, detail },
      { capability: 'LLM_EXTRACTION', ok, detail },
    ];
  }

  async generateText(request: LlmRequest, options: CallOptions): Promise<LlmTextResult> {
    const res = await this.send(request, undefined, options);
    const text = res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
    return { text, ...this.usage(res) };
  }

  async generateStructured<T>(request: StructuredLlmRequest<T>, options: CallOptions): Promise<LlmStructuredResult<T>> {
    const tool = { name: toolName(request.schemaName), description: `Return the ${request.schemaName} result.`, input_schema: request.jsonSchema ?? { type: 'object' } };
    const res = await this.send(request, tool, options);
    const call = res.content.find((c) => c.type === 'tool_use');
    if (!call || call.type !== 'tool_use') throw new ProviderCallError('PERMANENT', `Model did not return ${request.schemaName}`);
    let data: T;
    try {
      data = request.schema.parse(call.input);
    } catch (err) {
      throw new ProviderCallError('PERMANENT', `Model output does not match ${request.schemaName}`, { cause: err });
    }
    return { data, ...this.usage(res) };
  }

  private usage(res: MessagesResponse) {
    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    return { model: res.model, inputTokens, outputTokens, units: inputTokens + outputTokens };
  }

  private async send(request: LlmRequest, tool: { name: string; description: string; input_schema: Record<string, unknown> } | undefined, { signal }: CallOptions): Promise<MessagesResponse> {
    const body = {
      model: this.models[request.modelClass],
      max_tokens: request.maxOutputTokens ?? 2048,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: 'user', content: request.prompt }],
      ...(tool ? { tools: [tool], tool_choice: { type: 'tool', name: tool.name } } : {}),
    };
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ProviderCallError('TRANSIENT', `Anthropic unreachable: ${(err as Error).message}`);
    }
    if (res.ok) return (await res.json()) as MessagesResponse;

    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    const retryAfter = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    const message = `Anthropic HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
    if (res.status === 401) throw new ProviderCallError('AUTH_REQUIRED', message);
    if (res.status === 403) throw new ProviderCallError('PERMISSION_DENIED', message);
    if (res.status === 429) throw new ProviderCallError('RATE_LIMITED', message, { retryAfterMs });
    if (res.status === 529 || res.status === 503) throw new ProviderCallError('UNAVAILABLE', message, { retryAfterMs });
    if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 422) throw new ProviderCallError('INVALID_REQUEST', message);
    throw new ProviderCallError('TRANSIENT', message);
  }
}

const toolName = (schemaName: string) => schemaName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'result';
