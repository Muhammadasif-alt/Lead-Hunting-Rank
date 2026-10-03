import { CircleCheck, CircleAlert, Loader } from "lucide-react";
import type { HealthRow } from "@/lib/use-system-health";

export function HealthList({ rows, loading, compact = false }: { rows: HealthRow[]; loading: boolean; compact?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ key, label, health }) => {
        const up = health.status === "up";
        return (
          <li key={key} className={`flex items-center gap-3 ${compact ? "py-2.5" : "py-3.5"}`}>
            {loading ? (
              <Loader className="size-4 shrink-0 animate-spin text-faint" />
            ) : up ? (
              <CircleCheck className="size-4 shrink-0 text-brand" />
            ) : (
              <CircleAlert className="size-4 shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm">{label}</div>
              {!loading && !up && !compact && <div className="mt-0.5 truncate text-xs text-danger">{health.error}</div>}
            </div>
            {!loading && health.latencyMs !== undefined && (
              <span className="font-mono text-xs text-faint">{health.latencyMs} ms</span>
            )}
            {!loading && (
              <span className={`text-xs font-medium ${up ? "text-brand" : "text-danger"}`}>{up ? "Operational" : "Down"}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
