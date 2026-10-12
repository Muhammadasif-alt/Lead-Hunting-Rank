import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from '../core/interfaces.js';

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage?: { total_tokens?: number };
}

/** Up to this many texts per request (we batch below the vendor's limit). */
const BATCH = 64;

/**
 * Voyage AI embeddings behind the EmbeddingProvider interface (docs/12 §57-64, docs/13 §58-65). Documents and queries
 * are embedded with their input type; every vector is stored with `voyage/<model>` so a model change never compares
 * across models. Token usage is reported; cost stays unknown rather than guessed. No side effects — safe to retry.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly key = 'voyage';
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: VoyageOptions) {
    this.model = options.model ?? 'voyage-3.5-lite';
    this.baseUrl = options.baseUrl ?? 'https://api.voyageai.com';
    this.doFetch = options.fetch ?? fetch;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    const ok = !!this.options.apiKey;
    return [{ capability: 'EMBEDDINGS', ok, detail: ok ? `API key configured on the server (${this.model})` : 'No EMBEDDINGS_API_KEY on the server' }];
  }

  async embed(request: EmbeddingRequest, options: CallOptions): Promise<EmbeddingResult> {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < request.texts.length; i += BATCH) {
      const res = await this.send(request.texts.slice(i, i + BATCH), request.purpose, options);
      for (const d of [...res.data].sort((a, b) => a.index - b.index)) vectors.push(d.embedding);
      tokens += res.usage?.total_tokens ?? 0;
    }
    if (vectors.length !== request.texts.length) throw new ProviderCallError('PERMANENT', `Voyage returned ${vectors.length} vectors for ${request.texts.length} texts`);
    return { vectors, model: `voyage/${this.model}`, dimensions: vectors[0]?.length ?? 0, units: tokens };
  }

  private async send(texts: string[], purpose: EmbeddingRequest['purpose'], { signal }: CallOptions): Promise<VoyageResponse> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({ input: texts, model: this.model, input_type: purpose === 'QUERY' ? 'query' : 'document' }),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ProviderCallError('TRANSIENT', `Voyage unreachable: ${(err as Error).message}`);
    }
    if (res.ok) {
      const body = (await res.json()) as VoyageResponse;
      if (!Array.isArray(body?.data)) throw new ProviderCallError('PERMANENT', 'Voyage answered without vectors');
      return body;
    }
    const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '');
    const retryAfter = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    const message = `Voyage HTTP ${res.status}${detail ? `: ${detail}` : ''}`;
    if (res.status === 401) throw new ProviderCallError('AUTH_REQUIRED', message);
    if (res.status === 403) throw new ProviderCallError('PERMISSION_DENIED', message);
    if (res.status === 429) throw new ProviderCallError('RATE_LIMITED', message, { retryAfterMs });
    if (res.status === 503 || res.status === 502) throw new ProviderCallError('UNAVAILABLE', message, { retryAfterMs });
    if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 422) throw new ProviderCallError('INVALID_REQUEST', message);
    throw new ProviderCallError('TRANSIENT', message);
  }
}
