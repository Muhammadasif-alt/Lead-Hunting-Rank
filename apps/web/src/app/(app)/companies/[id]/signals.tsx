"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, Eye, Loader, Plus, RefreshCw } from "lucide-react";
import { SIGNAL_STRENGTHS, type CompanySignals, type PermissionKey, type WatchlistRow } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { useMe } from "@/lib/session-context";
import { STRENGTH_LABEL, shortDate, timeAgo } from "@/lib/signals";
import { SignalList, StrengthBadge } from "../../signals/parts";

const CHANGE_STYLE: Record<string, string> = { HIGH: "text-tone", MEDIUM: "text-amber", LOW: "text-faint", NONE: "text-faint" };

/** Company 360 "Signals" (screen #9 §33): open signals, the evolution timeline, what monitoring saw, and watchlists. */
export function SignalsTab({ companyId }: { companyId: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canManage = can("signal.manage");
  const [d, setD] = useState<CompanySignals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api<CompanySignals>(`/signals/companies/${companyId}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [companyId]);
  useEffect(() => void load(), [load]);

  async function check() {
    setBusy("check");
    setNotice(null);
    setError(null);
    try {
      await post(`/signals/companies/${companyId}/check`);
      setNotice("Re-check queued — the website is read again and compared with the last check. New signals appear here.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!can("signal.read")) return <p className="card px-4 py-8 text-center text-sm text-muted">You don’t have permission to view signals.</p>;
  if (!d)
    return error ? (
      <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    ) : (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading signals…
      </div>
    );

  return (
    <div className="space-y-4" data-tone="leads">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {d.open.length} open signal{d.open.length === 1 ? "" : "s"} · checked {d.lastCheckedAt ? timeAgo(d.lastCheckedAt) : "never"}
          {d.nextCheckAt ? ` · next check ${shortDate(d.nextCheckAt)}` : ""}
        </p>
        {canManage && (
          <button type="button" className="btn btn-secondary text-xs" disabled={!!busy} onClick={() => void check()}>
            {busy === "check" ? <Loader className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Check now
          </button>
        )}
      </div>
      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Open signals</h3>
            {d.open.length === 0 ? <p className="card px-4 py-6 text-center text-sm text-muted">No open signals. Nothing changed that gives a reason to act now.</p> : <SignalList rows={d.open} showCompany={false} />}
          </section>

          <section className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">Signal history</h3>
            {d.history.length === 0 ? (
              <p className="text-sm text-muted">No past signals yet — this becomes the company’s evolution timeline.</p>
            ) : (
              <ol className="space-y-2 border-l border-line pl-4">
                {d.history.map((s) => (
                  <li key={s.id} className="relative">
                    <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-tone" aria-hidden="true" />
                    <div className="text-xs text-faint">{shortDate(s.effectiveAt)}</div>
                    <Link href={`/signals/${s.id}`} className="text-sm font-medium break-words hover:text-tone">
                      {s.title}
                    </Link>
                    <div className="text-xs text-muted">
                      {s.typeLabel} · {STRENGTH_LABEL[s.strength].toLowerCase()} · {s.status.replace(/_/g, " ").toLowerCase()}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="card p-4 text-sm">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
              <Eye className="size-4 text-tone" /> Watchlists
            </h3>
            {d.watchlists.length === 0 ? (
              <p className="text-xs text-muted">Not on a watchlist — it is only re-checked when someone asks.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {d.watchlists.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{w.name}</span>
                    <span className="shrink-0 text-faint">{w.priority.toLowerCase()} priority</span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && <AddToWatchlist companyId={companyId} exclude={d.watchlists.map((w) => w.id)} onDone={load} />}
          </section>

          <section className="card p-4 text-sm">
            <h3 className="mb-1 font-semibold">Recent observations</h3>
            <p className="mb-2 text-xs text-faint">Every check, including the ones where nothing meaningful changed.</p>
            {d.observations.length === 0 ? (
              <p className="text-xs text-muted">No monitoring checks yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {d.observations.map((o, i) => (
                  <li key={i}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{o.subject}</span>
                      <span className={CHANGE_STYLE[o.changeLevel] ?? ""}>{o.changeLevel === "NONE" ? "no change" : `${o.changeLevel.toLowerCase()} change`}</span>
                      <span className="ml-auto text-faint">{timeAgo(o.observedAt)}</span>
                    </div>
                    <div className="text-faint">
                      {o.sourceKind.toLowerCase()}
                      {o.detail ? ` · ${o.detail}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function AddToWatchlist({ companyId, exclude, onDone }: { companyId: string; exclude: string[]; onDone: () => Promise<void> }) {
  const [lists, setLists] = useState<WatchlistRow[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<WatchlistRow[]>("/signals/watchlists")
      .then(setLists)
      .catch(() => setLists([]));
  }, []);
  const options = (lists ?? []).filter((w) => w.kind === "MANUAL" && !exclude.includes(w.id));
  if (lists && options.length === 0)
    return (
      <p className="mt-2 text-xs text-faint">
        <Link href="/signals?tab=watchlists" className="text-tone hover:underline">
          Create a hand-picked watchlist
        </Link>{" "}
        to watch this company.
      </p>
    );
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <select className="input h-8 min-w-0 flex-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Watchlist">
        <option value="">Add to watchlist…</option>
        {options.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-secondary h-8 text-xs"
        disabled={!pick || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await post(`/signals/watchlists/${pick}/members`, { companyIds: [companyId] });
            setPick("");
            await onDone();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Plus className="size-3.5" /> Add
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Header "Intent" block: the strongest open signal — never a made-up score. */
export function IntentBlock({ companyId }: { companyId: string }) {
  const me = useMe();
  const allowed = me.permissions.includes("signal.read");
  const [d, setD] = useState<CompanySignals | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    api<CompanySignals>(`/signals/companies/${companyId}`)
      .then(setD)
      .catch(() => setFailed(true));
  }, [companyId, allowed]);
  const strongest = d ? SIGNAL_STRENGTHS.find((st) => d.open.some((s) => s.strength === st)) : undefined;
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">Intent</div>
      {!allowed || failed ? (
        <div className="mt-1 text-lg font-semibold text-faint">—</div>
      ) : !d ? (
        <div className="mt-1 text-lg font-semibold text-faint">…</div>
      ) : strongest ? (
        <div className="mt-1">
          <StrengthBadge strength={strongest} />
        </div>
      ) : (
        <div className="mt-1 text-lg font-semibold text-faint">No open signals</div>
      )}
      <div className="mt-0.5 text-xs text-faint">
        {!allowed ? "No access to signals" : failed ? "Signals unavailable" : !d ? "Loading" : d.open.length ? `${d.open.length} open signal${d.open.length === 1 ? "" : "s"} · evidence of change, not proof of intent` : `checked ${d.lastCheckedAt ? timeAgo(d.lastCheckedAt) : "never"}`}
      </div>
    </div>
  );
}
