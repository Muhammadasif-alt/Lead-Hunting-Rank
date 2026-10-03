"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComponentHealth, SystemHealth } from "@revenue-os/shared";
import Sidebar from "../../components/layout/Sidebar";

type Row = { key: string; label: string; health: ComponentHealth };

export default function Diagnostics() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
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
    void check();
  }, [check]);

  const down: ComponentHealth = { status: "down", error: "API unreachable — is `pnpm dev:api` running?" };
  const rows: Row[] = [
    { key: "web", label: "Web (Next.js)", health: { status: "up" } },
    { key: "api", label: "API (NestJS)", health: health?.components.api ?? (apiError ? { status: "down", error: apiError } : down) },
    { key: "postgres", label: "PostgreSQL", health: health?.components.postgres ?? down },
    { key: "redis", label: "Redis", health: health?.components.redis ?? down },
    { key: "worker", label: "Worker (BullMQ)", health: health?.components.worker ?? down },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col gap-6 p-6">
        <div className="card flex items-center justify-between p-4">
          <div>
            <h1 className="text-xl font-semibold">System Diagnostics</h1>
            <p className="mt-1 text-sm text-[#7cbfa0]">
              Phase 0 milestone: Browser → Next.js → NestJS → PostgreSQL, and NestJS → Redis → BullMQ → Worker.
            </p>
          </div>
          <button
            onClick={() => void check()}
            disabled={loading}
            className="rounded-lg bg-[#00ff85] px-4 py-2 text-sm font-semibold text-[#000d08] disabled:opacity-50"
          >
            {loading ? "Checking…" : "Re-check"}
          </button>
        </div>

        <div className="card divide-y divide-[#00ff85]/10">
          {rows.map(({ key, label, health: h }) => (
            <div key={key} className="flex items-center justify-between gap-4 p-4">
              <div>
                <div className="text-sm font-medium">{label}</div>
                {h.status === "down" && !loading && <div className="mt-1 text-xs text-[#f87171]">{h.error}</div>}
              </div>
              <div className="flex items-center gap-3 text-sm">
                {h.latencyMs !== undefined && <span className="text-[#7cbfa0]">{h.latencyMs} ms</span>}
                {loading ? (
                  <span className="text-[#7cbfa0]">…</span>
                ) : h.status === "up" ? (
                  <span className="pill border-[#00ff85]/30 bg-[#00ff85]/10 text-[#00ff85]">✓ up</span>
                ) : (
                  <span className="pill border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171]">✕ down</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {health && <p className="text-xs text-[#7cbfa0]">Last checked {new Date(health.checkedAt).toLocaleTimeString()}</p>}
      </main>
    </div>
  );
}
