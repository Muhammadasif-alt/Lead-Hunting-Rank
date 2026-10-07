import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PermissionKey } from '@revenue-os/shared';
import type { Request } from 'express';
import type { Access } from './access.service.js';
import type { AuthService } from './auth.service.js';

export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const SKIP_WORKSPACE = Symbol('SKIP_WORKSPACE');
export const REQUIRED_PERMISSIONS = Symbol('REQUIRED_PERMISSIONS');
export const CSRF_EXEMPT = Symbol('CSRF_EXEMPT');

/** No session needed (login, health). Everything else requires authentication by default — fail closed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Skips the same-origin check. Only for public endpoints that use no cookie and are authorized by a secret in the URL
 * — e.g. one-click unsubscribe (RFC 8058), which mail providers POST from their own servers.
 */
export const CsrfExempt = () => SetMetadata(CSRF_EXEMPT, true);

/** Authenticated, but doesn't need a resolved workspace (e.g. listing your own sessions). */
export const SkipWorkspace = () => SetMetadata(SKIP_WORKSPACE, true);

/** Every listed permission is required. Checked server-side by PermissionGuard. */
export const RequirePermission = (...permissions: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export type AuthSession = NonNullable<Awaited<ReturnType<AuthService['resolveSession']>>>;

export interface AuthedRequest extends Request {
  session?: AuthSession;
  sessionToken?: string;
  access?: Access;
}

export const CurrentAccess = createParamDecorator((_: unknown, ctx: ExecutionContext): Access => {
  const access = ctx.switchToHttp().getRequest<AuthedRequest>().access;
  if (!access) throw new Error('CurrentAccess used on a route without WorkspaceGuard');
  return access;
});

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthSession => {
  const session = ctx.switchToHttp().getRequest<AuthedRequest>().session;
  if (!session) throw new Error('CurrentSession used on a public route');
  return session;
});
