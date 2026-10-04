/** Error from the API envelope `{ error: { code, message } }`, with the HTTP status for UI decisions (409 → reload). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Browser → `/api/v1/*` (same origin, session cookie). Returns `data` from the success envelope. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message: string } } | null;
  if (!res.ok)
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code);
  return body?.data as T;
}

export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
