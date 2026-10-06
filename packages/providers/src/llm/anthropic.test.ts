import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { z } from 'zod';
import { isConnectable, providerDefinition } from '../catalog.js';
import { ProviderCallError } from '../core/errors.js';
import { AnthropicProvider } from './anthropic.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });
const Schema = z.object({ level: z.enum(['HIGH', 'LOW']) });

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('AnthropicProvider (no network — fetch is mocked)', () => {
  test('structured output goes through one forced tool and is validated again', async () => {
    const { fn, calls } = fakeFetch(200, { model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', name: 'Level', input: { level: 'HIGH' } }], usage: { input_tokens: 120, output_tokens: 8 } });
    const llm = new AnthropicProvider({ apiKey: 'k', fetch: fn });
    const r = await llm.generateStructured({ modelClass: 'FAST', system: 'sys', prompt: 'p', schema: Schema, schemaName: 'Level', jsonSchema: { type: 'object' } }, o());
    assert.equal(r.data.level, 'HIGH');
    assert.equal(r.inputTokens, 120);
    assert.equal(r.costMinor, undefined, 'cost unknown, never guessed');
    const sent = JSON.parse(String(calls[0]!.init.body));
    assert.equal(sent.model, 'claude-haiku-4-5-20251001');
    assert.deepEqual(sent.tool_choice, { type: 'tool', name: 'Level' });
    assert.equal((calls[0]!.init.headers as Record<string, string>)['x-api-key'], 'k');
  });

  test('an answer that does not fit the schema is an error, never passed on', async () => {
    const { fn } = fakeFetch(200, { model: 'm', content: [{ type: 'tool_use', name: 'Level', input: { level: 'MAYBE' } }] });
    await assert.rejects(new AnthropicProvider({ apiKey: 'k', fetch: fn }).generateStructured({ modelClass: 'FAST', prompt: 'p', schema: Schema, schemaName: 'Level' }, o()), (e) => e instanceof ProviderCallError && e.kind === 'PERMANENT');
  });

  test('HTTP errors map onto the provider taxonomy', async () => {
    const kind = async (status: number, headers: Record<string, string> = {}) => {
      const { fn } = fakeFetch(status, 'nope', headers);
      try {
        await new AnthropicProvider({ apiKey: 'k', fetch: fn }).generateText({ modelClass: 'FAST', prompt: 'p' }, o());
        return 'ok';
      } catch (e) {
        return (e as ProviderCallError).kind;
      }
    };
    assert.equal(await kind(401), 'AUTH_REQUIRED');
    assert.equal(await kind(429, { 'retry-after': '7' }), 'RATE_LIMITED');
    assert.equal(await kind(529), 'UNAVAILABLE');
    assert.equal(await kind(400), 'INVALID_REQUEST');
    assert.equal(await kind(500), 'TRANSIENT');
  });

  test('connectable only when the server has LLM_PROVIDER=anthropic and a key', () => {
    const def = providerDefinition('anthropic')!;
    assert.equal(isConnectable(def, 'development'), false);
    assert.equal(isConnectable(def, 'production', { llmProvider: 'anthropic', llmKeyConfigured: true }), true);
    assert.equal(isConnectable(def, 'production', { llmProvider: 'fake', llmKeyConfigured: true }), false);
  });
});
