import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@revenue-os/shared';
import { getContext, type Logger } from '@revenue-os/shared/server';
import { LOGGER } from '../infra/tokens.js';
import { mapError } from './error-response.js';

/** Single place where every error becomes `{ error: { code, message, details, requestId } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const mapped = mapError(exception);
    const requestId = getContext()?.requestId ?? 'unknown';

    if (mapped.unexpected) {
      this.logger.error({ err: exception }, 'Unhandled error');
    } else {
      this.logger.warn({ code: mapped.code, details: mapped.details }, mapped.message);
    }

    const body: ApiErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        requestId,
      },
    };
    res.status(mapped.status).json(body);
  }
}
