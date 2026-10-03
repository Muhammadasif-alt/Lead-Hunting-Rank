import { pino, type Logger, type LoggerOptions } from 'pino';
import { getContext } from './context.js';

export type { Logger };

export interface LoggerConfig {
  service: 'api' | 'worker' | (string & {});
  level?: string;
  /** Human-readable coloured output for local development; JSON otherwise. */
  pretty?: boolean;
}

/**
 * Secrets must never reach logs (Tech Spec #11 §116-122). Paths are matched at any of these
 * positions; extend the list when a new kind of secret appears.
 */
const SECRET_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'authCode',
];
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SECRET_KEYS.map((key) => `*.${key}`),
  ...SECRET_KEYS.map((key) => `*.*.${key}`),
];

/**
 * Structured logger. Each line automatically includes requestId / correlationId / workspaceId /
 * actorId / jobId from the current execution context.
 */
export function createLogger({ service, level = 'info', pretty = false }: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    mixin: () => ({ ...getContext() }),
  };
  if (pretty) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname,service',
        messageFormat: '[{service}] {msg}',
        singleLine: true,
      },
    };
  }
  return pino(options);
}
