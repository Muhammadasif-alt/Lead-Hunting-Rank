"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentHealth, SystemHealth } from "@revenue-os/shared";

export interface HealthRow {
  key: string;
  label: string;
  health: ComponentHealth;
}

/** Fetches GET /api/health (proxied to the NestJS API) and normalises it into display rows. */
export function useSystemHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      setHealth((await res.json()) as SystemHealth);
    } catch (err) {
      setHealth(null);
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unreachable: ComponentHealth = { status: "down", error: "API unreachable — is `pnpm dev:api` running?" };
  const rows: HealthRow[] = [
    { key: "web", label: "Web app", health: { status: "up" } },
    { key: "api", label: "API", health: health?.components.api ?? { status: "down", error: apiError ?? unreachable.error } },
    { key: "postgres", label: "PostgreSQL", health: health?.components.postgres ?? unreachable },
    { key: "redis", label: "Redis", health: health?.components.redis ?? unreachable },
    { key: "worker", label: "Background worker", health: health?.components.worker ?? unreachable },
  ];
  const allUp = !loading && rows.every((r) => r.health.status === "up");

  return { rows, allUp, loading, checkedAt: health?.checkedAt ?? null, refresh };
}
