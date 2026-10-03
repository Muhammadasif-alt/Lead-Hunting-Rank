import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@revenue-os/shared/server';

/** Routes Nest's own framework logs (bootstrap, route mapping…) through the structured logger. */
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
