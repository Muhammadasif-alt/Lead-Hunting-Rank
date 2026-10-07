import { createHash, randomBytes } from 'node:crypto';
import { ProviderCallError } from '../core/errors.js';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Minimum Gmail scopes (docs/12 §19-30): send from the mailbox, and read it — to notice replies, unsubscribes and
 * bounces, and to reconcile a send whose response was lost. No delete, no settings, no contacts.
 */
export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** What we keep (encrypted) per Gmail integration. */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  scope: string;
  email: string;
}

/** PKCE (RFC 7636): the code is useless to anyone who intercepts it without our verifier. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string, codeChallenge: string, scopes = GMAIL_SCOPES): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // offline + consent: Google returns a refresh token, so sending keeps working after the hour-long access token.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(body: URLSearchParams, fetchFn: typeof fetch): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new ProviderCallError('UNAVAILABLE', 'Google token endpoint unreachable', { cause: err });
  }
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok && json.access_token) return json;
  // invalid_grant = the user revoked access or the refresh token expired → reconnect.
  if (json.error === 'invalid_grant' || res.status === 401) throw new ProviderCallError('AUTH_REQUIRED', `Google refused the credentials (${json.error ?? res.status}) — reconnect the mailbox`);
  if (res.status === 429 || res.status >= 500) throw new ProviderCallError('UNAVAILABLE', `Google token endpoint returned ${res.status}`);
  throw new ProviderCallError('INVALID_REQUEST', `Google token request failed (${json.error ?? res.status})`);
}

/** The email in the ID token (decoded, not trusted for anything but naming the account; Gmail's profile confirms it). */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(cfg: GoogleOAuthConfig, code: string, codeVerifier: string, fetchFn: typeof fetch = fetch): Promise<GoogleTokens> {
  const json = await tokenCall(
    new URLSearchParams({ code, code_verifier: codeVerifier, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }),
    fetchFn,
  );
  if (!json.refresh_token) throw new ProviderCallError('INVALID_REQUEST', 'Google returned no refresh token — remove the app from your Google account and connect again');
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope ?? '',
    email: emailFromIdToken(json.id_token) ?? '',
  };
}

export async function refreshGoogleToken(cfg: Pick<GoogleOAuthConfig, 'clientId' | 'clientSecret'>, tokens: GoogleTokens, fetchFn: typeof fetch = fetch): Promise<GoogleTokens> {
  const json = await tokenCall(new URLSearchParams({ refresh_token: tokens.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }), fetchFn);
  return { ...tokens, accessToken: json.access_token!, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope ?? tokens.scope, refreshToken: json.refresh_token ?? tokens.refreshToken };
}

/** Best effort: tell Google to drop the grant when a mailbox is disconnected. */
export async function revokeGoogleToken(token: string, fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}
