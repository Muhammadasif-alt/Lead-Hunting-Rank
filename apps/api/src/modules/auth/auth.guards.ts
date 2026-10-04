import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppConfig } from '@revenue-os/config';
import { ForbiddenError, UnauthenticatedError, type PermissionKey } from '@revenue-os/shared';
import { updateContext } from '@revenue-os/shared/server';
import { APP_CONFIG } from '../../infra/tokens.js';
import { AccessService } from './access.service.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC, REQUIRED_PERMISSIONS, SKIP_WORKSPACE, type AuthedRequest } from './auth.decorators.js';
import { readSessionToken } from './session-cookie.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const acceptWorkspaceHeader = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : undefined);

function flag(reflector: Reflector, key: symbol, ctx: ExecutionContext): boolean {
  return reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) === true;
}

/**
 * CSRF (docs/15): state-changing requests must come from our own web origin. Combined with SameSite=Lax
 * cookies this blocks cross-site form posts and fetches. Applies to login too (login CSRF).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.allowed = new Set([new URL(config.APP_URL).origin, new URL(config.API_URL).origin]);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(req.method)) return true;
    const source = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
    if (source && this.allowed.has(source)) return true;
    throw new ForbiddenError('Cross-site request blocked');
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Every route requires a valid session unless marked @Public(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionToken(req);
    const session = token ? await this.auth.resolveSession(token) : null;
    if (!session || !token) throw new UnauthenticatedError('Sign in to continue');
    req.session = session;
    req.sessionToken = token;
    updateContext({ actorType: 'user', actorId: session.userId });
    return true;
  }
}

/**
 * Resolves the workspace for this request: the session's active workspace, or `x-workspace-id` if the user is
 * a member there. Membership is verified server-side; a client can't name another workspace and gain access.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (flag(this.reflector, IS_PUBLIC, ctx) || flag(this.reflector, SKIP_WORKSPACE, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.session) throw new UnauthenticatedError('Sign in to continue');
    const header = req.headers['x-workspace-id'];
    const requested = acceptWorkspaceHeader(Array.isArray(header) ? header[0] : header);
    if (header !== undefined && !requested) throw new ForbiddenError('Invalid workspace');
    req.access = await this.access.resolve(req.session.userId, requested ?? req.session.workspaceId);
    updateContext({ workspaceId: req.access.workspaceId });
    return true;
  }
}

/** Enforces @RequirePermission(...) — 403 when any listed permission is missing. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AccessService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const access = ctx.switchToHttp().getRequest<AuthedRequest>().access;
    if (!access) throw new ForbiddenError('Workspace access required');
    for (const permission of required) this.accessService.assert(access, permission);
    return true;
  }
}

/**
 * Resource scope: a route that names a workspace (`:workspaceId`) may only act on the resolved one.
 * Record-level OWN/ASSIGNED/TEAM scopes are checked in application services as those resources arrive.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const named = req.params?.workspaceId;
    if (named && req.access && named !== req.access.workspaceId) throw new ForbiddenError('You do not have access to this workspace');
    return true;
  }
}
