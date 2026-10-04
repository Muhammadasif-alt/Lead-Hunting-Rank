import type { CookieOptions, Request } from 'express';
import type { AppConfig } from '@revenue-os/config';
import { SESSION_MAX_MS } from './auth.service.js';

export const SESSION_COOKIE = 'rhl_session';

/** HttpOnly so page scripts can't read it; SameSite=Lax + the origin check stop cross-site use; Secure in production. */
export function sessionCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.APP_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_MS,
  };
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = decodeURIComponent(part.slice(eq + 1).trim());
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}
