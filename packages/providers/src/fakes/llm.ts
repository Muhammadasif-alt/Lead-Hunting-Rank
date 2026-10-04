import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, LlmRequest, LlmStructuredResult, LlmTextResult, LLMProvider, OutputSchema } from '../core/interfaces.js';
import { FailureQueue, type FakeFailure } from './failures.js';

/**
 * Deterministic stand-in for a language model. Tests script answers with `respondWith`; otherwise it echoes a short
 * summary of the prompt. Structured output is validated against the caller's schema exactly as a real model's would
 * be — an answer that doesn't fit is an error, never passed on (docs/12 §62). Token counts are estimates (chars / 4).
 */
export class FakeLLMProvider implements LLMProvider {
  readonly key = 'fake_llm';
  private readonly failures = new FailureQueue();
  private readonly scripted: unknown[] = [];
  readonly requests: LlmRequest[] = [];

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  /** Queue answers: strings for generateText, objects (or JSON strings) for generateStructured. */
  respondWith(...answers: unknown[]): this {
    this.scripted.push(...answers);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [
      { capability: 'LLM_REASONING', ok: true, detail: 'Model reachable (test model)' },
      { capability: 'LLM_EXTRACTION', ok: true, detail: 'Model reachable (test model)' },
    ];
  }

  async generateText(request: LlmRequest, { signal }: CallOptions): Promise<LlmTextResult> {
    await this.failures.before(signal);
    this.requests.push(request);
    const answer = this.scripted.length ? this.scripted.shift() : `[fake ${request.modelClass.toLowerCase()} model] ${request.prompt.slice(0, 120)}`;
    const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return this.result(request, text);
  }

  async generateStructured<T>(request: LlmRequest & { schema: OutputSchema<T>; schemaName: string }, { signal }: CallOptions): Promise<LlmStructuredResult<T>> {
    await this.failures.before(signal);
    this.requests.push(request);
    if (!this.scripted.length) throw new ProviderCallError('INVALID_REQUEST', `Fake model has no scripted answer for ${request.schemaName}`);
    const answer = this.scripted.shift();
    let value: unknown = answer;
    if (typeof answer === 'string') {
      try {
        value = JSON.parse(answer);
      } catch {
        throw new ProviderCallError('PERMANENT', `Model output for ${request.schemaName} is not valid JSON`);
      }
    }
    let data: T;
    try {
      data = request.schema.parse(value);
    } catch (err) {
      throw new ProviderCallError('PERMANENT', `Model output does not match ${request.schemaName}`, { cause: err });
    }
    const { text: _text, ...meta } = this.result(request, JSON.stringify(value));
    return { ...meta, data };
  }

  private result(request: LlmRequest, text: string): LlmTextResult {
    const inputTokens = Math.ceil(((request.system?.length ?? 0) + request.prompt.length) / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return { text, model: `fake-${request.modelClass.toLowerCase()}`, inputTokens, outputTokens, units: inputTokens + outputTokens, costMinor: 0 };
  }
}
