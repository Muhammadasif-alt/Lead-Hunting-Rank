import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@revenue-os/shared';
import { acceptExternalId, newId, runWithContext, type Logger } from '@revenue-os/shared/server';

/**
 * Runs every HTTP request inside its own execution context:
 * - requestId is always generated server-side
 * - correlationId is reused from the client only if it's a safe-looking ID, otherwise generated
 * Both are echoed back as response headers so the browser/devtools can quote them in bug reports.
 */
export function requestContextMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = newId();
    const correlationId = acceptExternalId(req.header(HEADERS.correlationId)) ?? requestId;
    res.setHeader(HEADERS.requestId, requestId);
    res.setHeader(HEADERS.correlationId, correlationId);

    runWithContext({ requestId, correlationId }, () => {
      const start = performance.now();
      res.on('finish', () => {
        const entry = {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        };
        // Health checks are polled — keep them out of normal logs.
        const level = entry.path?.startsWith('/api/health') ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
        logger[level](entry, `${entry.method} ${entry.path} → ${entry.status} (${entry.durationMs} ms)`);
      });
      next();
    });
  };
}
