import { createHash } from 'node:crypto';
import { ProviderCallError } from '../core/errors.js';
import type { CallOptions, CapabilityCheck, EmailChanges, EmailMessage, EmailProvider, SendEmailInput, SendEmailResult } from '../core/interfaces.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

export interface GmailProviderOptions {
  /** A valid access token for this mailbox (refreshed by the caller when needed). */
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

/**
 * The RFC 5322 Message-ID we give a send, derived from its idempotency key. A lost response is reconciled by searching
 * the mailbox for exactly this id, and a follow-up threads onto it with In-Reply-To (docs/12 §30).
 */
export function messageIdFor(idempotencyKey: string, from: string): string {
  const domain = from.slice(from.lastIndexOf('@') + 1) || 'revenue-os.local';
  return `<ros-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}@${domain}>`;
}

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);
const encodeHeader = (s: string) => (ascii(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const noBreaks = (s: string) => s.replace(/[\r\n]+/g, ' ');

/** A plain-text RFC 5322 message. Header values are stripped of line breaks — no header injection. */
export function buildMime(input: SendEmailInput, messageId: string, date = new Date()): string {
  const from = input.fromName ? `${encodeHeader(noBreaks(input.fromName).replace(/"/g, ''))} <${input.from}>` : input.from;
  const headers = [
    `From: ${noBreaks(from)}`,
    `To: ${input.to.map(noBreaks).join(', ')}`,
    `Subject: ${encodeHeader(noBreaks(input.subject))}`,
    `Message-ID: ${messageId}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${noBreaks(input.inReplyTo)}`, `References: ${noBreaks(input.inReplyTo)}`);
  if (input.unsubscribeUrl) {
    // RFC 8058 one-click unsubscribe — mailbox providers show an "Unsubscribe" button that POSTs here.
    headers.push(`List-Unsubscribe: <${noBreaks(input.unsubscribeUrl)}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }
  const body = (Buffer.from(input.text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
}

function header(part: GmailPart | undefined, name: string): string {
  return part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function plainText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts ?? []) {
    const t = plainText(p);
    if (t) return t;
  }
  return '';
}

const address = (h: string) => (/<([^>]+)>/.exec(h)?.[1] ?? h).trim().toLowerCase();

export function toEmailMessage(m: GmailMessage): EmailMessage {
  return {
    messageId: m.id,
    threadId: m.threadId,
    from: address(header(m.payload, 'From')),
    to: header(m.payload, 'To').split(',').map(address).filter(Boolean),
    subject: header(m.payload, 'Subject'),
    text: plainText(m.payload) || m.snippet || '',
    direction: m.labelIds?.includes('SENT') ? 'OUTBOUND' : 'INBOUND',
    occurredAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    internetMessageId: header(m.payload, 'Message-ID') || undefined,
  };
}

/**
 * Gmail through its REST API (docs/12 §19-30). Sends as the connected mailbox, reads its new mail by history cursor,
 * reconciles a lost send by Message-ID. Vendor errors become the normalized taxonomy; a 5xx on send is "outcome
 * unknown" (reconcile, never resend blindly).
 */
export class GmailProvider implements EmailProvider {
  readonly key = 'gmail';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GmailProviderOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  private async request<T>(path: string, { signal }: CallOptions, init: RequestInit = {}, sideEffect = false): Promise<T> {
    const token = await this.options.getAccessToken();
    const res = await this.fetchFn(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      signal,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const detail = `Gmail ${res.status}${reason ? ` ${reason}` : ''}: ${body.error?.message ?? res.statusText}`.slice(0, 300);
    const retryAfter = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    if (res.status === 401) throw new ProviderCallError('AUTH_REQUIRED', detail);
    if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new ProviderCallError('RATE_LIMITED', detail, { retryAfterMs });
    if (reason === 'dailyLimitExceeded' || reason === 'quotaExceeded') throw new ProviderCallError('QUOTA_EXCEEDED', detail, { retryAfterMs });
    if (res.status === 403) throw new ProviderCallError('PERMISSION_DENIED', detail);
    if (res.status === 404) throw new ProviderCallError('NOT_FOUND', detail);
    if (res.status >= 400 && res.status < 500) throw new ProviderCallError('INVALID_REQUEST', detail);
    throw new ProviderCallError(sideEffect ? 'UNKNOWN_OUTCOME' : 'UNAVAILABLE', detail);
  }

  async healthCheck(options: CallOptions): Promise<CapabilityCheck[]> {
    // Reads only: the profile and the token's scopes. A health test never sends an email (docs/12 §118).
    const token = await this.options.getAccessToken();
    const info = await this.fetchFn(`${TOKENINFO}?access_token=${encodeURIComponent(token)}`, { signal: options.signal });
    const scopes = info.ok ? (((await info.json()) as { scope?: string }).scope ?? '') : '';
    const profile = await this.request<{ emailAddress: string }>('/profile', options);
    return [
      { capability: 'EMAIL_SEND', ok: scopes.includes('gmail.send'), detail: scopes.includes('gmail.send') ? `Send granted for ${profile.emailAddress}` : 'Send permission not granted — reconnect' },
      { capability: 'EMAIL_READ', ok: scopes.includes('gmail.readonly'), detail: scopes.includes('gmail.readonly') ? 'Read granted' : 'Read permission not granted — replies cannot be noticed' },
    ];
  }

  async sendMessage(input: SendEmailInput, options: CallOptions) {
    const messageId = messageIdFor(input.idempotencyKey, input.from);
    const raw = Buffer.from(buildMime(input, messageId), 'utf8').toString('base64url');
    const sent = await this.request<{ id: string; threadId: string }>('/messages/send', options, { method: 'POST', body: JSON.stringify({ raw, ...(input.threadRef ? { threadId: input.threadRef } : {}) }) }, true);
    return { messageId: sent.id, threadId: sent.threadId, sentAt: new Date().toISOString(), internetMessageId: messageId, units: 1 };
  }

  async findSentByIdempotencyKey(idempotencyKey: string, options: CallOptions, from?: string): Promise<SendEmailResult | null> {
    if (!from) return null;
    const q = encodeURIComponent(`rfc822msgid:${messageIdFor(idempotencyKey, from).slice(1, -1)}`);
    const list = await this.request<{ messages?: { id: string; threadId: string }[] }>(`/messages?q=${q}&includeSpamTrash=true&maxResults=1`, options);
    const m = list.messages?.[0];
    return m ? { messageId: m.id, threadId: m.threadId, sentAt: new Date().toISOString() } : null;
  }

  async getMessage(messageId: string, options: CallOptions) {
    try {
      return toEmailMessage(await this.request<GmailMessage>(`/messages/${encodeURIComponent(messageId)}?format=full`, options));
    } catch (err) {
      if (err instanceof ProviderCallError && err.kind === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async getThread(threadId: string, options: CallOptions) {
    const t = await this.request<{ messages?: GmailMessage[] }>(`/threads/${encodeURIComponent(threadId)}?format=full`, options);
    return (t.messages ?? []).map(toEmailMessage);
  }

  /** New mail since the cursor (Gmail historyId). The first call only records where to start — no backfill. */
  async listChanges(cursor: string | null, options: CallOptions): Promise<EmailChanges> {
    const start = async () => ({ messages: [], cursor: (await this.request<{ historyId: string }>('/profile', options)).historyId });
    if (!cursor) return start();
    let history: { history?: { messagesAdded?: { message: { id: string } }[] }[]; historyId?: string };
    try {
      history = await this.request(`/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&maxResults=100`, options);
    } catch (err) {
      // The cursor is too old (Gmail keeps about a week) — continue from now rather than fail forever.
      if (err instanceof ProviderCallError && err.kind === 'NOT_FOUND') return start();
      throw err;
    }
    const ids = [...new Set((history.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((a) => a.message.id)))];
    const messages: EmailMessage[] = [];
    for (const id of ids.slice(0, 100)) {
      const m = await this.getMessage(id, options);
      if (m) messages.push(m);
    }
    return { messages, cursor: history.historyId ?? cursor };
  }
}
