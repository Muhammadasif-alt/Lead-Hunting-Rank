"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, CircleAlert, Loader, Lock, Search } from "lucide-react";
import { SUPPRESSION_REASONS, type SuppressionReason, type SuppressionScope } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { SCOPE_LABEL, type SuppressionRow } from "@/lib/policy";
import { useMe } from "@/lib/session-context";

const ADDABLE: SuppressionScope[] = ["EMAIL", "DOMAIN", "PHONE"];
const PLACEHOLDER: Partial<Record<SuppressionScope, string>> = {
  EMAIL: "name@company.com",
  DOMAIN: "company.com",
  PHONE: "+1 512 555 0100",
};
const REASONS = Object.keys(SUPPRESSION_REASONS) as SuppressionReason[];

/**
 * Do-not-contact list (docs/10 §37-47). Suppression always wins — over campaigns, autonomy and approvals — and adding
 * one cancels pending messages to that address at once. Unsubscribes, complaints and legal holds can never be lifted.
 */
export function Suppressions() {
  const me = useMe();
  const canAdd = me.permissions.includes("company.update");
  const canLift = me.permissions.includes("policy.manage");
  const [status, setStatus] = useState<"ACTIVE" | "LIFTED" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ scope: SuppressionScope; value: string; reason: SuppressionReason; note: string }>(
    {
      scope: "EMAIL",
      value: "",
      reason: "DO_NOT_CONTACT",
      note: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lifting, setLifting] = useState<{ id: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ status });
      if (search.trim()) q.set("search", search.trim());
      setRows(await api<SuppressionRow[]>(`/policy/suppressions?${q}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [status, search]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const r = await post<{ created: boolean; cancelledActions: number }>("/policy/suppressions", {
        scope: form.scope,
        value: form.value,
        reason: form.reason,
        note: form.note.trim() || null,
      });
      setNotice(
        !r.created
          ? "Already on the list."
          : r.cancelledActions
            ? `Added. ${r.cancelledActions} pending message${r.cancelledActions === 1 ? " was" : "s were"} cancelled.`
            : "Added. Nothing will be sent to it.",
      );
      setForm((f) => ({ ...f, value: "", note: "" }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function lift() {
    if (!lifting) return;
    setBusy(true);
    try {
      await post(`/policy/suppressions/${lifting.id}/lift`, { reason: lifting.reason });
      setLifting(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Ban className="size-4 text-tone" /> Do-not-contact list
        </h2>
        <p className="mt-1 text-sm text-muted">
          Nothing is ever sent to anyone here — not by a person, a campaign or the AI, even if approved. Companies and
          people can be added from their page.
        </p>
      </div>

      {canAdd ? (
        <form
          onSubmit={(e) => void add(e)}
          className="card grid gap-3 p-4 sm:grid-cols-[8rem_1fr_11rem] lg:grid-cols-[8rem_1fr_11rem_1fr_auto]"
        >
          <select
            className="input h-9"
            aria-label="Type"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value as SuppressionScope })}
          >
            {ADDABLE.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
          <input
            className="input h-9 min-w-0"
            aria-label="Value"
            required
            maxLength={320}
            placeholder={PLACEHOLDER[form.scope]}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
          <select
            className="input h-9"
            aria-label="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value as SuppressionReason })}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {SUPPRESSION_REASONS[r].label}
              </option>
            ))}
          </select>
          <input
            className="input h-9 min-w-0"
            aria-label="Note"
            maxLength={1000}
            placeholder="Note (optional)"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
          <button type="submit" className="btn btn-primary h-9" disabled={busy || !form.value.trim()}>
            {busy && <Loader className="size-4 animate-spin" />} Add
          </button>
        </form>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-faint">
          <Lock className="size-3.5" /> Your role can view the list but not add to it
        </p>
      )}
      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            className="input h-9 w-full pl-9"
            placeholder="Search"
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="flex gap-1 rounded-lg border border-line p-1 text-sm">
          {(["ACTIVE", "LIFTED", "ALL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`rounded-md px-3 py-1 ${status === s ? "bg-tone-soft text-tone" : "text-muted hover:bg-hover"}`}
              onClick={() => setStatus(s)}
            >
              {s === "ACTIVE" ? "Active" : s === "LIFTED" ? "Lifted" : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="card divide-y divide-line">
        {!rows ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Nobody on the list{search ? " matches" : " yet"}.</p>
        ) : (
          rows.map((r) => {
            const liftable = SUPPRESSION_REASONS[r.reason].liftable;
            return (
              <div key={r.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="badge">{SCOPE_LABEL[r.scope]}</span>
                  {r.scope === "COMPANY" ? (
                    <Link
                      href={`/companies/${r.value}`}
                      className="min-w-0 truncate font-medium text-accent hover:underline"
                    >
                      {r.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate font-medium">{r.label}</span>
                  )}
                  <span className="text-muted">{SUPPRESSION_REASONS[r.reason].label}</span>
                  <span className="text-xs text-faint">
                    {r.status === "LIFTED" && r.liftedAt
                      ? `lifted ${formatAgo(r.liftedAt)}`
                      : `added ${formatAgo(r.createdAt)}`}
                  </span>
                  {r.status === "ACTIVE" && canLift && liftable && lifting?.id !== r.id && (
                    <button
                      type="button"
                      className="btn btn-ghost ml-auto h-8"
                      onClick={() => setLifting({ id: r.id, reason: "" })}
                    >
                      Lift
                    </button>
                  )}
                  {r.status === "ACTIVE" && !liftable && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-faint">
                      <Lock className="size-3.5" /> Permanent
                    </span>
                  )}
                </div>
                {(r.note || r.liftReason) && (
                  <p className="mt-1 text-xs text-muted">
                    {r.status === "LIFTED" ? `Lifted: ${r.liftReason}` : r.note}
                  </p>
                )}
                {lifting?.id === r.id && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className="input h-9 min-w-0 flex-1"
                      placeholder="Why lift it? (required)"
                      autoFocus
                      value={lifting.reason}
                      onChange={(e) => setLifting({ ...lifting, reason: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn-primary h-9"
                      disabled={busy || !lifting.reason.trim()}
                      onClick={() => void lift()}
                    >
                      Lift
                    </button>
                    <button type="button" className="btn btn-ghost h-9" onClick={() => setLifting(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
