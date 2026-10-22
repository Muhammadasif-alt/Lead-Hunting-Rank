"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader, Plus, Route } from "lucide-react";
import type { DealLineage } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { money, shortDate, toMinor } from "@/lib/analytics";
import { LineageChain } from "./attribution";

const REVENUE_TYPE_LABEL: Record<string, string> = { WON: "Won", PAYMENT: "Payment", EXPANSION: "Expansion", REFUND: "Refund" };
type RecordType = "PAYMENT" | "EXPANSION" | "REFUND";

/**
 * Opportunity page (screen #10 §3): the deal's acquisition path and, for won deals, its revenue events.
 * Revenue is recorded in major units in the form and sent in minor units.
 */
export function DealAnalytics({ opportunityId, won, canRecord }: { opportunityId: string; won: boolean; canRecord: boolean }) {
  const [d, setD] = useState<DealLineage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setD(await api<DealLineage>(`/analytics/deals/${opportunityId}/lineage`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [opportunityId]);
  useEffect(() => void load(), [load]);

  return (
    <>
      <section className="card space-y-3 p-4 text-sm" data-tone="insight">
        <div className="eyebrow flex items-center gap-1.5 text-[11px]">
          <Route className="size-3.5" aria-hidden /> Acquisition path
        </div>
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : !d ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          <LineageChain d={d} />
        )}
      </section>
      {won && d && <DealRevenue d={d} canRecord={canRecord} onChange={load} />}
    </>
  );
}

function DealRevenue({ d, canRecord, onChange }: { d: DealLineage; canRecord: boolean; onChange: () => Promise<void> }) {
  const [type, setType] = useState<RecordType>("PAYMENT");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const net = d.revenue.reduce((a, r) => a + (r.type === "REFUND" ? -r.amountMinor : r.amountMinor), 0);
  const minor = toMinor(amount);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!minor) return;
    setBusy(true);
    setError(null);
    try {
      await post("/analytics/revenue", { opportunityId: d.opportunityId, type, amountMinor: minor, currency: d.currency, occurredAt: date ? new Date(date).toISOString() : undefined, note: note.trim() || undefined });
      setAmount("");
      setDate("");
      setNote("");
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-4 text-sm" data-tone="insight">
      <div className="flex items-baseline justify-between gap-2">
        <div className="eyebrow text-[11px]">Revenue</div>
        <div className="text-xs text-muted">
          Net <span className="font-semibold text-fg">{money(net, d.currency)}</span>
        </div>
      </div>
      {d.revenue.length === 0 ? (
        <p className="text-xs text-muted">No revenue events recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {d.revenue.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="block font-medium">{REVENUE_TYPE_LABEL[r.type] ?? r.type}</span>
                <span className="block text-xs text-faint break-words">
                  {shortDate(r.occurredAt)}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${r.type === "REFUND" ? "text-danger" : ""}`}>
                {r.type === "REFUND" ? "−" : ""}
                {money(r.amountMinor, r.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canRecord && (
        <form onSubmit={(e) => void submit(e)} className="space-y-2 border-t border-line pt-3">
          <div className="text-xs font-semibold">Record revenue</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">
              Type
              <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as RecordType)}>
                <option value="PAYMENT">Payment</option>
                <option value="EXPANSION">Expansion</option>
                <option value="REFUND">Refund</option>
              </select>
            </label>
            <label className="text-xs text-muted">
              Amount ({d.currency})
              <input className="input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,250.00" />
            </label>
            <label className="text-xs text-muted">
              Date
              <input type="date" className="input mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="text-xs text-muted">
              Note
              <input className="input mt-1" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          {amount && !minor && <p className="text-xs text-danger">Enter a positive amount.</p>}
          {error && <p className="text-xs text-danger">{error}</p>}
          <button type="submit" className="btn btn-secondary h-8 w-full" disabled={busy || !minor}>
            {busy ? <Loader className="size-4 animate-spin" /> : <Plus className="size-4" />} Record {type.toLowerCase()}
          </button>
          <p className="text-[11px] text-faint">Leave the date empty for today. Refunds reduce won revenue.</p>
        </form>
      )}
    </section>
  );
}
