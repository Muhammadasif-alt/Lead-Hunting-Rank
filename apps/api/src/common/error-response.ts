import { HttpException } from '@nestjs/common';
import { AppError, type ErrorCode, type ErrorDetail } from '@revenue-os/shared';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  /** true → unexpected failure: log with stack, hide internals from the client. */
  unexpected: boolean;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'RESOURCE_NOT_FOUND',
  409: 'VERSION_CONFLICT',
  413: 'VALIDATION_ERROR',
  415: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  503: 'PROVIDER_UNAVAILABLE',
};

/**
 * Maps anything thrown inside a request to the standard error envelope fields (Tech Spec #10 §16).
 * Never leaks stack traces, SQL, file paths or provider payloads for unexpected errors (Tech Spec #11).
 */
export function mapError(exception: unknown): MappedError {
  if (exception instanceof AppError) {
    return {
      status: exception.httpStatus,
      code: exception.code,
      message: exception.message,
      details: exception.details,
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status];
    if (code && status < 500) {
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
          ? body.message
          : exception.message;
      return { status, code, message, unexpected: false };
    }
  }

  // Express body-parser errors (malformed JSON, payload too large) carry a 4xx `status`.
  const status = (exception as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const code = STATUS_TO_CODE[status] ?? 'VALIDATION_ERROR';
    const message = status === 413 ? 'Request body is too large' : 'Request body is not valid JSON';
    return { status, code, message, unexpected: false };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Quote the request ID when reporting this.',
    unexpected: true,
  };
}
