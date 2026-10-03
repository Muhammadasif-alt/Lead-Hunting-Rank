import type { ErrorCode, ErrorDetail } from './errors.js';

/** Response envelopes (Tech Spec #10 §16). Every /api/v1 endpoint returns one of these. */
export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

/** Header names used to propagate tracing identity between web, API and workers. */
export const HEADERS = {
  requestId: 'x-request-id',
  correlationId: 'x-correlation-id',
} as const;
