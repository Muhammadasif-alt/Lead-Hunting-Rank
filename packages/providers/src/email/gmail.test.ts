import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptSecret, encryptSecret } from '../credentials/secret.js';
import { ProviderCallError } from '../core/errors.js';
import { buildMime, GmailProvider, messageIdFor } from './gmail.js';
import { exchangeGoogleCode, googleAuthUrl, pkcePair } from './google-oauth.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });
type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: [RegExp, (call: Call) => Response][]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const route = routes.find(([re]) => re.test(call.url));
    return route ? route[1](call) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('MIME: plain text, encoded subject, one-click unsubscribe, threading, no header injection', () => {
  const mime = buildMime({ from: 'sam@ours.example', fromName: 'Sam "S"', to: ['ann@x.example'], subject: 'Héllo\r\nBcc: evil@x.example', text: 'Hi Ann', idempotencyKey: 'k1', unsubscribeUrl: 'https://app.example/api/v1/public/unsubscribe/t', inReplyTo: '<ros-1@ours.example>' }, '<ros-abc@ours.example>');
  const [head, body] = mime.split('\r\n\r\n');
  assert.match(head!, /^From: Sam S <sam@ours\.example>/m);
  assert.match(head!, /^Subject: =\?UTF-8\?B\?/m);
  assert.doesNotMatch(head!, /^Bcc:/m, 'a line break in the subject cannot add a header');
  assert.match(head!, /^List-Unsubscribe: <https:\/\/app\.example\/api\/v1\/public\/unsubscribe\/t>$/m);
  assert.match(head!, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);
  assert.match(head!, /^In-Reply-To: <ros-1@ours\.example>$/m);
  assert.match(head!, /^Message-ID: <ros-abc@ours\.example>$/m);
  assert.equal(Buffer.from(body!, 'base64').toString('utf8'), 'Hi Ann');
  assert.equal(messageIdFor('k1', 'sam@ours.example'), messageIdFor('k1', 'sam@ours.example'), 'deterministic per idempotency key');
});

test('send: posts raw MIME in the thread, returns ids; reconcile finds it by Message-ID', async () => {
  const { fn, calls } = fakeFetch([
    [/messages\/send$/, () => json({ id: 'm1', threadId: 't1' })],
    [/messages\?q=rfc822msgid/, () => json({ messages: [{ id: 'm1', threadId: 't1' }] })],
  ]);
  const gmail = new GmailProvider({ getAccessToken: async () => 'tok', fetch: fn });
  const r = await gmail.sendMessage({ from: 'sam@ours.example', to: ['ann@x.example'], subject: 'Hi', text: 'Hello', idempotencyKey: 'campaign:1', threadRef: 't0' }, o());
  assert.deepEqual([r.messageId, r.threadId], ['m1', 't1']);
  assert.equal(r.internetMessageId, messageIdFor('campaign:1', 'sam@ours.example'));
  const sent = JSON.parse(String(calls[0]!.init!.body)) as { raw: string; threadId: string };
  assert.equal(sent.threadId, 't0');
  assert.match(Buffer.from(sent.raw, 'base64url').toString('utf8'), /^To: ann@x\.example$/m);
  assert.equal((calls[0]!.init!.headers as Record<string, string>).authorization, 'Bearer tok');
  const found = await gmail.findSentByIdempotencyKey('campaign:1', o(), 'sam@ours.example');
  assert.equal(found?.messageId, 'm1');
  assert.match(decodeURIComponent(calls[1]!.url), /rfc822msgid:ros-[0-9a-f]+@ours\.example/);
});

test('errors map to the provider taxonomy; a 5xx on send is "outcome unknown"', async () => {
  const kind = async (status: number, reason = '', path = 'send') => {
    const { fn } = fakeFetch([[/./, () => json({ error: { message: 'x', errors: reason ? [{ reason }] : [] } }, status)]]);
    const gmail = new GmailProvider({ getAccessToken: async () => 'tok', fetch: fn });
    try {
      if (path === 'send') await gmail.sendMessage({ from: 'a@b.example', to: ['c@d.example'], subject: 's', text: 't', idempotencyKey: 'k' }, o());
      else await gmail.getThread('t', o());
    } catch (err) {
      return (err as ProviderCallError).kind;
    }
    return 'none';
  };
  assert.equal(await kind(401), 'AUTH_REQUIRED');
  assert.equal(await kind(429), 'RATE_LIMITED');
  assert.equal(await kind(403, 'dailyLimitExceeded'), 'QUOTA_EXCEEDED');
  assert.equal(await kind(403, 'insufficientPermissions'), 'PERMISSION_DENIED');
  assert.equal(await kind(400), 'INVALID_REQUEST');
  assert.equal(await kind(500), 'UNKNOWN_OUTCOME');
  assert.equal(await kind(500, '', 'read'), 'UNAVAILABLE');
});

test('listChanges: first call only sets the cursor; then new messages are parsed (inbound vs sent)', async () => {
  const body = Buffer.from('Thanks, tell me more\n\nOn Mon wrote:\n> hi', 'utf8').toString('base64url');
  const { fn } = fakeFetch([
    [/\/profile$/, () => json({ emailAddress: 'sam@ours.example', historyId: '100' })],
    [/\/history\?/, () => json({ history: [{ messagesAdded: [{ message: { id: 'r1' } }] }, { messagesAdded: [{ message: { id: 'r1' } }] }], historyId: '105' })],
    [
      /\/messages\/r1/,
      () =>
        json({
          id: 'r1',
          threadId: 't1',
          labelIds: ['INBOX'],
          internalDate: '1767700000000',
          payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: 'Ann <ANN@x.example>' }, { name: 'To', value: 'sam@ours.example' }, { name: 'Subject', value: 'Re: Hi' }], parts: [{ mimeType: 'text/plain', body: { data: body } }] },
        }),
    ],
  ]);
  const gmail = new GmailProvider({ getAccessToken: async () => 'tok', fetch: fn });
  const first = await gmail.listChanges(null, o());
  assert.deepEqual(first, { messages: [], cursor: '100' });
  const next = await gmail.listChanges('100', o());
  assert.equal(next.cursor, '105');
  assert.equal(next.messages.length, 1, 'deduplicated');
  assert.deepEqual([next.messages[0]!.from, next.messages[0]!.direction, next.messages[0]!.threadId], ['ann@x.example', 'INBOUND', 't1']);
  assert.match(next.messages[0]!.text, /tell me more/);
});

test('OAuth: PKCE + offline consent URL with minimum scopes; code exchange needs a refresh token', async () => {
  const cfg = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:4000/cb' };
  const { verifier, challenge } = pkcePair();
  assert.notEqual(verifier, challenge);
  const url = new URL(googleAuthUrl(cfg, 'state1', challenge));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.match(url.searchParams.get('scope')!, /gmail\.send/);
  assert.doesNotMatch(url.searchParams.get('scope')!, /gmail\.modify|mail\.google\.com/);
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'sam@ours.example' })).toString('base64url')}.y`;
  const { fn, calls } = fakeFetch([[/token$/, () => json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'gmail.send gmail.readonly', id_token: idToken })]]);
  const t = await exchangeGoogleCode(cfg, 'code1', verifier, fn);
  assert.deepEqual([t.accessToken, t.refreshToken, t.email], ['a', 'r', 'sam@ours.example']);
  assert.match(String(calls[0]!.init!.body), /code_verifier=/);
  const { fn: noRefresh } = fakeFetch([[/token$/, () => json({ access_token: 'a', expires_in: 3600 })]]);
  await assert.rejects(exchangeGoogleCode(cfg, 'code1', verifier, noRefresh), /refresh token/);
  const { fn: revoked } = fakeFetch([[/token$/, () => json({ error: 'invalid_grant' }, 400)]]);
  await assert.rejects(exchangeGoogleCode(cfg, 'code1', verifier, revoked), (e) => e instanceof ProviderCallError && e.kind === 'AUTH_REQUIRED');
});

test('credentials: AES-256-GCM round trip; tampering or a wrong key fails', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const enc = encryptSecret({ refreshToken: 'r' }, key);
  assert.doesNotMatch(enc.ciphertext, /refreshToken/);
  assert.deepEqual(decryptSecret(enc, key), { refreshToken: 'r' });
  assert.throws(() => decryptSecret({ ...enc, ciphertext: Buffer.from('tampered').toString('base64') }, key));
  assert.throws(() => decryptSecret(enc, Buffer.alloc(32, 8).toString('base64')));
  assert.throws(() => encryptSecret({}, undefined), /ENCRYPTION_KEY/);
});
