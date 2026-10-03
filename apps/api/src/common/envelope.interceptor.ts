import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiSuccess } from '@revenue-os/shared';
import { getContext } from '@revenue-os/shared/server';
import { map, type Observable } from 'rxjs';

const RAW_RESPONSE = Symbol('RAW_RESPONSE');

/** Opt a controller/handler out of the `{ data, meta }` envelope (infrastructure endpoints like health). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Wraps handler results as `{ data, meta: { requestId } }` (Tech Spec #10 §16). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();
    return next.handle().pipe(
      map(
        (data): ApiSuccess<unknown> => ({
          data,
          meta: { requestId: getContext()?.requestId ?? 'unknown' },
        }),
      ),
    );
  }
}
