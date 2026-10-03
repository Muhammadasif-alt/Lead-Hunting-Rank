/**
 * Turns any thrown value into a one-line human message.
 * Handles AggregateError (Node's dual-stack connect failures) and wrappers with empty messages
 * (e.g. Prisma), so health checks and logs say "connect ECONNREFUSED 127.0.0.1:6380" instead of "".
 */
export function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return describeError(err.errors[err.errors.length - 1]);
  }
  if (err instanceof Error) {
    const message = err.message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const code = (err as { code?: unknown }).code;
    const uninformative = !message || message.endsWith(':');
    if (uninformative && err.cause !== undefined) return describeError(err.cause);
    if (typeof code === 'string' && (uninformative || !message.includes(code))) {
      return uninformative ? `${code} (connection failed)` : `${code} — ${message}`;
    }
    return message ?? err.name;
  }
  return String(err);
}
