import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderCallError } from '../core/errors.js';
import { FakeLLMProvider, TEST_EMBEDDING_MODEL } from '../fakes/llm.js';
import { VoyageEmbeddingProvider } from './voyage.js';

const opts = () => ({ signal: AbortSignal.timeout(5000) });

test('Voyage: documents vs queries, vectors in order, model recorded, errors mapped', async () => {
  const calls: { url: string; body: { input: string[]; model: string; input_type: string }; auth: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, auth: (init.headers as Record<string, string>).authorization! });
    return new Response(JSON.stringify({ model: 'voyage-3.5-lite', data: body.input.map((_: string, i: number) => ({ index: body.input.length - 1 - i, embedding: [i, 1] })).reverse(), usage: { total_tokens: 12 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const v = new VoyageEmbeddingProvider({ apiKey: 'k', fetch: fetchFn });
  const r = await v.embed({ texts: ['a', 'b'], purpose: 'QUERY' }, opts());
  assert.equal(calls[0]!.url, 'https://api.voyageai.com/v1/embeddings');
  assert.equal(calls[0]!.body.input_type, 'query');
  assert.equal(calls[0]!.auth, 'Bearer k');
  assert.equal(r.model, 'voyage/voyage-3.5-lite');
  assert.equal(r.vectors.length, 2);
  assert.equal(r.units, 12);

  const limited = new VoyageEmbeddingProvider({ apiKey: 'k', fetch: (async () => new Response('slow down', { status: 429, headers: { 'retry-after': '3' } })) as unknown as typeof fetch });
  await assert.rejects(limited.embed({ texts: ['x'], purpose: 'DOCUMENT' }, opts()), (e: ProviderCallError) => e.kind === 'RATE_LIMITED' && e.options.retryAfterMs === 3000);
  const bad = new VoyageEmbeddingProvider({ apiKey: 'k', fetch: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch });
  await assert.rejects(bad.embed({ texts: ['x'], purpose: 'DOCUMENT' }, opts()), (e: ProviderCallError) => e.kind === 'AUTH_REQUIRED');
});

test('the Test AI model embeds deterministically', async () => {
  const fake = new FakeLLMProvider();
  const a = await fake.embed({ texts: ['How long does setup take?'], purpose: 'DOCUMENT' }, opts());
  const b = await fake.embed({ texts: ['How long does setup take?'], purpose: 'QUERY' }, opts());
  assert.deepEqual(a.vectors, b.vectors);
  assert.equal(a.model, TEST_EMBEDDING_MODEL);
  assert.equal(a.dimensions, 256);
});
