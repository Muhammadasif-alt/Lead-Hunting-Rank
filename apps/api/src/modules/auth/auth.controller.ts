import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { AccessService, type Access } from './access.service.js';
import { AuthService } from './auth.service.js';
import { CurrentAccess, CurrentSession, Public, SkipWorkspace, type AuthSession, type AuthedRequest } from './auth.decorators.js';
import { SESSION_COOKIE, readSessionToken, sessionCookieOptions } from './session-cookie.js';

const LoginInput = z.strictObject({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
});

const SwitchWorkspaceInput = z.strictObject({ workspaceId: z.uuid() });
const ChangePasswordInput = z.strictObject({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginInput)) input: z.output<typeof LoginInput>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, session } = await this.auth.login(input.email, input.password, { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] });
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(this.config));
    return this.profile(await this.access.resolve(session.userId, session.workspaceId));
  }

  /** Always succeeds and clears the cookie; revokes the session if there is one. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = readSessionToken(req);
    if (token) await this.auth.logout(token);
    const { maxAge: _maxAge, ...opts } = sessionCookieOptions(this.config);
    res.clearCookie(SESSION_COOKIE, opts);
    return { signedOut: true };
  }

  @Get('me')
  me(@CurrentAccess() access: Access) {
    return this.profile(access);
  }

  @Post('workspace')
  @SkipWorkspace()
  @HttpCode(200)
  async switchWorkspace(
    @Body(new ZodValidationPipe(SwitchWorkspaceInput)) input: z.output<typeof SwitchWorkspaceInput>,
    @CurrentSession() session: AuthSession,
  ) {
    const access = await this.access.resolve(session.userId, input.workspaceId); // 403 unless a member
    await this.auth.switchWorkspace(session.id, input.workspaceId);
    return this.profile(access);
  }

  @Get('sessions')
  @SkipWorkspace()
  async sessions(@CurrentSession() session: AuthSession) {
    const rows = await this.auth.listSessions(session.userId);
    return rows.map((s) => ({ ...s, current: s.id === session.id }));
  }

  @Delete('sessions/:id')
  @SkipWorkspace()
  async revoke(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() session: AuthSession) {
    await this.auth.revokeSession(session.userId, id);
    return { revoked: true };
  }

  @Post('password')
  @SkipWorkspace()
  @HttpCode(200)
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordInput)) input: z.output<typeof ChangePasswordInput>,
    @CurrentSession() session: AuthSession,
    @Req() req: AuthedRequest,
  ) {
    // Re-verify the current password (step-up) before changing it; other sessions are revoked.
    await this.auth.verifyCurrentPassword(session.userId, input.currentPassword, { ip: req.ip ?? 'unknown' });
    await this.auth.setPassword(session.userId, input.newPassword, session.id);
    return { changed: true };
  }

  private async profile(access: Access) {
    const [user, workspace, memberships] = await Promise.all([
      this.prisma.client.user.findUniqueOrThrow({ where: { id: access.userId }, select: { id: true, email: true, name: true, timezone: true } }),
      this.prisma.client.workspace.findUniqueOrThrow({ where: { id: access.workspaceId }, select: { id: true, name: true, slug: true } }),
      this.prisma.client.workspaceMember.findMany({
        where: { userId: access.userId, status: 'ACTIVE', workspace: { status: 'ACTIVE' } },
        select: { workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);
    return {
      user,
      workspace,
      roles: access.roles,
      permissions: [...access.permissions].sort(),
      authorityLimits: Object.fromEntries(access.limits),
      workspaces: memberships.map((m) => m.workspace),
    };
  }
}
