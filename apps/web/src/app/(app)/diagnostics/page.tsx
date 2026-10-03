"use client";

import { RefreshCw } from "lucide-react";
import { HealthList } from "@/components/app/HealthList";
import { PageHeader } from "@/components/app/PageHeader";
import { findScreen } from "@/lib/screens";
import { useSystemHealth } from "@/lib/use-system-health";

export default function Diagnostics() {
  const { rows, allUp, loading, checkedAt, refresh } = useSystemHealth();

  return (
    <div className="space-y-8">
      <PageHeader
        screen={findScreen("/diagnostics")}
        actions={
          <button type="button" onClick={() => void refresh()} disabled={loading} className="btn btn-secondary">
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Checking…" : "Re-check"}
          </button>
        }
      />

      <div
        className={`card flex items-center gap-3 px-5 py-4 ${
          loading ? "" : allUp ? "border-brand/30 bg-brand-soft" : "border-danger/30 bg-danger-soft"
        }`}
      >
        <span className={`size-2.5 rounded-full ${loading ? "bg-faint" : allUp ? "bg-brand" : "bg-danger"}`} />
        <span className="text-sm font-medium">
          {loading ? "Running checks…" : allUp ? "All systems operational" : "Some services need attention"}
        </span>
        {checkedAt && (
          <span className="ml-auto text-xs text-muted">Checked {new Date(checkedAt).toLocaleTimeString()}</span>
        )}
      </div>

      <section className="card px-6 py-2">
        <HealthList rows={rows} loading={loading} />
      </section>

      <p className="text-xs leading-relaxed text-faint">
        Checks the full path: browser → Next.js → NestJS API → PostgreSQL, and API → Redis → BullMQ → worker (a real
        ping job). If something is down, make sure Docker Desktop is running, then <code className="font-mono">pnpm infra:up</code>{" "}
        and <code className="font-mono">pnpm dev</code>.
      </p>
    </div>
  );
}
