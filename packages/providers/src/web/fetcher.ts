import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, FetchedPage, PageFetchFailure, WebsiteProvider } from '../core/interfaces.js';

export interface HttpWebsiteFetcherOptions {
  /** Largest body we read; the rest is cut (the page is marked truncated). */
  maxBytes?: number;
  /** Deadline for one page including redirects. A slow website is a website fact, not a provider failure. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: hosts (e.g. a loopback test server) exempt from the private-network rules. Never set in the app. */
  allowHosts?: string[];
  userAgent?: string;
}

const HTML_TYPES = /^(?:text\/html|application\/xhtml\+xml)\b/i;

/**
 * Addresses a website fetch must never reach (SSRF, docs/12 §49, docs/15): loopback, private, link-local (cloud
 * metadata 169.254.169.254), carrier-grade NAT, documentation/benchmark ranges, multicast and reserved space — for
 * IPv4, IPv6 and IPv4-mapped IPv6.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isBlockedAddress(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true; // mapped, hex form — refuse rather than decode
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('2001:db8') || ip.startsWith('100::');
  }
  return true;
}

/** Only plain http(s) on standard ports, no credentials, no IP literals in blocked ranges, no internal hostnames. */
export function checkFetchableUrl(raw: string, allowHosts: ReadonlySet<string> = new Set()): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: `scheme ${url.protocol} is not allowed` };
  if (url.username || url.password) return { ok: false, reason: 'URLs with credentials are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const exempt = allowHosts.has(host);
  if (!exempt && url.port && url.port !== '80' && url.port !== '443') return { ok: false, reason: `port ${url.port} is not allowed` };
  if (!exempt) {
    if (isIP(host) && isBlockedAddress(host)) return { ok: false, reason: 'private or reserved address' };
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
      return { ok: false, reason: 'internal host name' };
    }
  }
  return { ok: true, url };
}

class FetchStop extends Error {
  constructor(
    readonly failure: PageFetchFailure,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The real website reader (docs/12 §48-52). Guards against SSRF on every hop: the URL is checked, redirects are
 * followed by hand and re-checked, and the address a connection actually uses is validated inside DNS lookup — so a
 * hostname that re-resolves to an internal IP (DNS rebinding) is refused too. Bodies are size-capped, only HTML is
 * read, cookies are never stored or sent.
 */
export class HttpWebsiteFetcher implements WebsiteProvider {
  readonly key = 'web_fetcher';
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly allowHosts: ReadonlySet<string>;
  private readonly userAgent: string;

  constructor(options: HttpWebsiteFetcherOptions = {}) {
    this.maxBytes = options.maxBytes ?? 1_500_000;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.allowHosts = new Set(options.allowHosts ?? []);
    this.userAgent = options.userAgent ?? 'Mozilla/5.0 (compatible; RevenueOS-Research/1.0)';
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [{ capability: 'WEBSITE_FETCH', ok: true, detail: 'Website reader ready (no network call in a health check)' }];
  }

  async fetchPage(url: string, { signal }: CallOptions): Promise<FetchedPage> {
    const first = checkFetchableUrl(url, this.allowHosts);
    if (!first.ok) throw new ProviderCallError('INVALID_REQUEST', `Website reader refused ${url}: ${first.reason}`);

    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const fetchedAt = new Date().toISOString();
    const redirects: string[] = [];
    let current = first.url;
    const result = (partial: Partial<FetchedPage>): FetchedPage => ({
      requestedUrl: url,
      finalUrl: current.toString(),
      status: 0,
      contentType: null,
      body: '',
      bytes: 0,
      truncated: false,
      fetchedAt,
      redirects,
      failure: null,
      failureDetail: null,
      units: 1,
      ...partial,
    });

    try {
      for (let hop = 0; ; hop++) {
        const res = await this.open(current, deadline);
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (hop >= this.maxRedirects) return result({ status, failure: 'TOO_MANY_REDIRECTS', failureDetail: `more than ${this.maxRedirects} redirects` });
          const next = checkFetchableUrl(new URL(location, current).toString(), this.allowHosts);
          if (!next.ok) return result({ status, failure: 'BLOCKED', failureDetail: `redirect refused: ${next.reason}` });
          redirects.push(current.toString());
          current = next.url;
          continue;
        }
        const contentType = (res.headers['content-type'] as string | undefined) ?? null;
        if (status >= 400) {
          res.resume();
          return result({ status, contentType, failure: 'HTTP_ERROR', failureDetail: `the site answered HTTP ${status}` });
        }
        if (!contentType || !HTML_TYPES.test(contentType)) {
          res.resume();
          return result({ status, contentType, failure: 'NOT_HTML', failureDetail: `not a web page (${contentType ?? 'no content type'})` });
        }
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > this.maxBytes * 4) {
          res.resume();
          return result({ status, contentType, failure: 'TOO_LARGE', failureDetail: `page is ${declared} bytes` });
        }
        const { body, bytes, truncated } = await this.readBody(res, deadline);
        return result({ status, contentType, body, bytes, truncated });
      }
    } catch (err) {
      if (err instanceof FetchStop) return result({ failure: err.failure, failureDetail: err.message });
      if (signal.aborted) throw err; // the gateway's own deadline — let it classify
      if (deadline.aborted) return result({ failure: 'TIMEOUT', failureDetail: `no answer within ${Math.round(this.timeoutMs / 1000)} s` });
      const code = (err as { code?: string }).code;
      if (code === 'EBLOCKED') return result({ failure: 'BLOCKED', failureDetail: (err as Error).message });
      return result({ failure: 'UNREACHABLE', failureDetail: code ? `${code} ${current.hostname}` : (err as Error).message });
    }
  }

  private open(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    const allowHosts = this.allowHosts;
    // Validates the address the socket will really connect to (defeats DNS rebinding between check and connect).
    const lookup = (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      dnsLookup(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
        if (err) return callback(err);
        const blocked = !allowHosts.has(hostname.toLowerCase()) && addresses.find((a) => isBlockedAddress(a.address));
        if (blocked) return callback(Object.assign(new Error(`${hostname} resolves to a private or reserved address`), { code: 'EBLOCKED' }));
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    };
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          signal,
          lookup: lookup as never,
          headers: {
            'user-agent': this.userAgent,
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en',
          },
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
  }

  private readBody(res: IncomingMessage, signal: AbortSignal): Promise<{ body: string; bytes: number; truncated: boolean }> {
    const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const stream = encoding === 'gzip' ? res.pipe(createGunzip()) : encoding === 'deflate' ? res.pipe(createInflate()) : encoding === 'br' ? res.pipe(createBrotliDecompress()) : res;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let done = false;
      const finish = (truncated: boolean) => {
        if (done) return;
        done = true;
        res.destroy();
        resolve({ body: Buffer.concat(chunks).toString('utf8'), bytes, truncated });
      };
      signal.addEventListener('abort', () => !done && (done = true) && reject(new FetchStop('TIMEOUT', 'the page did not finish loading in time')), { once: true });
      stream.on('data', (chunk: Buffer) => {
        if (done) return;
        const room = this.maxBytes - bytes;
        chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        bytes += Math.min(chunk.length, room);
        if (bytes >= this.maxBytes) finish(true);
      });
      stream.on('end', () => finish(false));
      stream.on('error', (err) => !done && (done = true) && reject(new FetchStop('UNREACHABLE', `could not read the page: ${err.message}`)));
    });
  }
}
