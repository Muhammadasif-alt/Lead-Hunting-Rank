import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, type Me } from "./me";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Server-side session check: asks the API who the cookie belongs to. Returns null when signed out or expired.
 * This — not the proxy — is the real gate for app pages (the proxy only does a fast cookie-presence check).
 */
export async function getMe(): Promise<Me | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data: Me }).data;
  } catch {
    return null;
  }
}
