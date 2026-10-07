import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { googleOAuthConfig, type AppConfig } from '@revenue-os/config';
import { recordEvent } from '@revenue-os/events';
import { CredentialStore, exchangeGoogleCode, googleAuthUrl, pkcePair, providerDefinition, revokeGoogleToken, type GoogleTokens } from '@revenue-os/providers';
import { checkIntegrationHealth, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { ValidationError } from '@revenue-os/shared';
import { writeAudit, type ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { PROVIDER_RUNTIME } from './provider-runtime.js';

const STATE_TTL_MS = 10 * 60_000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Gmail connection by OAuth (docs/12 §19-30): state bound to workspace + user, short expiry, single use, PKCE; the code
 * is exchanged on the server; tokens are stored encrypted and never leave it. Reconnecting the same mailbox reuses its
 * integration row.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private cfg() {
    const cfg = googleOAuthConfig(this.config);
    if (!cfg) throw new ValidationError('Gmail can’t be connected yet: the server needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and ENCRYPTION_KEY in .env');
    return cfg;
  }

  async start(ctx: ServiceContext): Promise<{ url: string }> {
    const cfg = this.cfg();
    const state = randomBytes(32).toString('base64url');
    const { verifier, challenge } = pkcePair();
    await this.prisma.client.oAuthState.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.actor.id!, provider: 'gmail', stateHash: hash(state), codeVerifier: verifier, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return { url: googleAuthUrl(cfg, state, challenge) };
  }

  /** Google redirects back here. Returns where to send the browser (the Integrations screen with the outcome). */
  async callback(q: { state?: string; code?: string; error?: string }): Promise<string> {
    const back = (params: Record<string, string>) => `${this.config.APP_URL.replace(/\/$/, '')}/integrations?${new URLSearchParams(params)}`;
    if (!q.state) return back({ oauth: 'error', reason: 'Missing state' });
    const row = await this.prisma.client.oAuthState.findUnique({ where: { stateHash: hash(q.state) } });
    // Single use: the first callback claims the state; a replay finds it used.
    const claimed = row ? await this.prisma.client.oAuthState.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } }) : { count: 0 };
    if (!row || claimed.count !== 1) return back({ oauth: 'error', reason: 'This sign-in link expired — start again' });
    if (q.error || !q.code) return back({ oauth: 'error', reason: q.error === 'access_denied' ? 'Access was not granted' : 'Google did not return a code' });

    const ctx: ServiceContext = { workspaceId: row.workspaceId, actor: { type: 'HUMAN', id: row.userId } };
    try {
      const tokens = await exchangeGoogleCode(this.cfg(), q.code, row.codeVerifier);
      if (!tokens.scope.includes('gmail.send') || !tokens.scope.includes('gmail.readonly')) return back({ oauth: 'error', reason: 'Send and read permissions are both needed — tick both on the Google screen' });
      const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(15_000) });
      const email = profile.ok ? ((await profile.json()) as { emailAddress?: string }).emailAddress?.toLowerCase() : null;
      if (!email) return back({ oauth: 'error', reason: 'Could not read the mailbox address' });
      const def = providerDefinition('gmail')!;
      const integration = await this.prisma.client.$transaction(async (tx) => {
        const existing = await tx.integration.findUnique({ where: { workspaceId_provider_accountRef: { workspaceId: ctx.workspaceId, provider: 'gmail', accountRef: email } } });
        const data = { status: 'ACTIVE' as const, name: email, capabilities: def.capabilities, category: def.category, connectedBy: row.userId, connectedAt: new Date(), disconnectedAt: null, lastError: null };
        const saved = existing
          ? await tx.integration.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
          : await tx.integration.create({ data: { ...data, workspaceId: ctx.workspaceId, provider: 'gmail', accountRef: email } });
        await new CredentialStore(tx, this.config.ENCRYPTION_KEY).save(ctx.workspaceId, saved.id, { ...tokens, email } satisfies GoogleTokens);
        await tx.integration.update({ where: { id: saved.id }, data: { credentialRef: `integration_credential:${saved.id}` } });
        await writeAudit(tx, ctx, { action: existing ? 'integration.reconnected' : 'integration.connected', entityType: 'INTEGRATION', entityId: saved.id, after: { provider: 'gmail', account: email } });
        await recordEvent(tx, ctx, 'IntegrationConnected', saved.id, { integrationId: saved.id, provider: 'gmail', reconnected: Boolean(existing) });
        return saved;
      });
      await checkIntegrationHealth(this.prisma.client, this.runtime, integration).catch(() => null);
      return back({ oauth: 'connected', account: email });
    } catch (err) {
      return back({ oauth: 'error', reason: err instanceof Error ? err.message.slice(0, 200) : 'Connection failed' });
    }
  }

  /** On disconnect: tell Google to drop the grant and delete our stored tokens (docs/12 §119). */
  async forget(integrationId: string): Promise<void> {
    const store = new CredentialStore(this.prisma.client, this.config.ENCRYPTION_KEY);
    const tokens = await store.load<GoogleTokens>(integrationId).catch(() => null);
    if (tokens) await revokeGoogleToken(tokens.refreshToken);
    await store.remove(integrationId);
  }
}
