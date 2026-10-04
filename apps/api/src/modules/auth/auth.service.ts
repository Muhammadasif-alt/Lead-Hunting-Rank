import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError, normalizeEmail } from '@revenue-os/shared';
import { burnPasswordCheck, checkPasswordPolicy, hashPassword, verifyPassword } from '@revenue-os/shared/server';
import { PrismaService } from '../../infra/prisma.service.js';
import { writeAudit } from '../../domain/service-context.js';
import { LoginThrottleService } from './login-throttle.service.js';

/** Idle timeout and absolute lifetime — no effectively permanent sessions (docs/15 §4-14). */
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** lastUsedAt is refreshed at most this often, to avoid a write on every request. */
const TOUCH_EVERY_MS = 60 * 1000;

const INVALID = 'Email or password is incorrect';

export interface ClientMeta {
  ip: string;
  userAgent?: string;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Login, logout and server-side sessions. Tokens are random; only their hash is stored. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: LoginThrottleService,
  ) {}

  async login(emailInput: string, password: string, meta: ClientMeta) {
    const email = normalizeEmail(emailInput) ?? emailInput.trim().toLowerCase();
    await this.throttle.assertAllowed(email, meta.ip);

    const user = await this.prisma.client.user.findUnique({ where: { email } });
    // Same response and similar timing whether or not the account exists (no account enumeration).
    const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false);
    if (!user || !valid || user.status !== 'ACTIVE') {
      await this.throttle.recordFailure(email, meta.ip);
      throw new UnauthenticatedError(INVALID);
    }

    const membership = await this.prisma.client.workspaceMember.findFirst({
      where: { userId: user.id, status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
      orderBy: { joinedAt: 'asc' },
    });
    if (!membership) throw new ForbiddenError('Your account is not a member of any active workspace');

    await this.throttle.reset(email);
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const session = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: user.id,
          workspaceId: membership.workspaceId,
          tokenHash: hashToken(token),
          idleExpiresAt: new Date(now + SESSION_IDLE_MS),
          expiresAt: new Date(now + SESSION_MAX_MS),
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 512),
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date(now) } });
      await writeAudit(tx, { workspaceId: membership.workspaceId, actor: { type: 'HUMAN', id: user.id } }, {
        action: 'auth.login',
        entityType: 'USER',
        entityId: user.id,
        after: { sessionId: created.id, ip: meta.ip },
      });
      return created;
    });
    return { token, session };
  }

  /** Returns the live session for a token, sliding its idle timeout. Null if missing, revoked or expired. */
  async resolveSession(token: string) {
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
    });
    const now = Date.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= now ||
      session.idleExpiresAt.getTime() <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      return null;
    }
    if (now - session.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now), idleExpiresAt: new Date(Math.min(now + SESSION_IDLE_MS, session.expiresAt.getTime())) },
      });
    }
    return session;
  }

  async logout(token: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  async listSessions(userId: string) {
    return this.prisma.client.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.client.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'revoked_by_user' },
    });
    if (count === 0) throw new NotFoundError('Session not found');
  }

  async switchWorkspace(sessionId: string, workspaceId: string): Promise<void> {
    await this.prisma.client.session.update({ where: { id: sessionId }, data: { workspaceId } });
  }

  /** Step-up check before sensitive changes. Counts towards the same login throttle. */
  async verifyCurrentPassword(userId: string, password: string, meta: ClientMeta): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    await this.throttle.assertAllowed(user.email, meta.ip);
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      await this.throttle.recordFailure(user.email, meta.ip);
      throw new UnauthenticatedError('Current password is incorrect');
    }
  }

  /** Sets a password (policy-checked) and revokes the user's other sessions. */
  async setPassword(userId: string, password: string, keepSessionId?: string): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const problem = checkPasswordPolicy(password, user.email);
    if (problem) throw new ValidationError(problem, [{ path: 'password', message: problem }]);
    const passwordHash = await hashPassword(password);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: userId }, data: { passwordHash, passwordUpdatedAt: new Date() } }),
      this.prisma.client.session.updateMany({
        where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
        data: { revokedAt: new Date(), revokedReason: 'password_changed' },
      }),
    ]);
  }
}
