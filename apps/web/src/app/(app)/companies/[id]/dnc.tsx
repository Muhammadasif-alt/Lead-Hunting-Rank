"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Loader, ShieldCheck } from "lucide-react";
import { SUPPRESSION_REASONS } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import type { SuppressionRow } from "@/lib/policy";
import { useMe } from "@/lib/session-context";

/**
 * Company-level do-not-contact (docs/10 §37-47 company DNC). When on, no one at this company is contacted — by a person,
 * a campaign or the AI — and pending messages to it are cancelled. Lifting is done on the Settings list.
 */
export function DoNotContact({ companyId }: { companyId: string }) {
  const me = useMe();
  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<SuppressionRow[]>(`/policy/suppressions?status=ACTIVE&scope=COMPANY&value=${companyId}`));
    } catch {
      setRows([]);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function suppress() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await post<{ cancelledActions: number }>("/policy/suppressions", {
        scope: "COMPANY",
        value: companyId,
        reason: "DO_NOT_CONTACT",
        note: note.trim() || null,
      });
      setOpen(false);
      setNote("");
      setMessage(r.cancelledActions ? `${r.cancelledActions} pending message(s) cancelled.` : null);
      await load();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return null;
  const active = rows[0];
  if (active) {
    return (
      <div className="card border-danger/30 bg-danger-soft p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold text-danger">
          <Ban className="size-4" /> Do not contact
        </div>
        <p className="mt-1 text-muted">
          {SUPPRESSION_REASONS[active.reason].label} · added {formatAgo(active.createdAt)}
          {active.note ? ` — ${active.note}` : ""}. Nothing is sent to anyone here, even if approved.
        </p>
        {message && <p className="mt-1 text-muted">{message}</p>}
        <Link href="/settings" className="mt-2 inline-block text-xs text-accent hover:underline">
          Do-not-contact list
        </Link>
      </div>
    );
  }
  if (!me.permissions.includes("company.update")) return null;
  return (
    <div className="card p-4 text-sm">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-muted">
            <ShieldCheck className="size-4 text-brand" /> Contact allowed
          </span>
          <button type="button" className="btn btn-ghost h-8 text-danger" onClick={() => setOpen(true)}>
            <Ban className="size-4" /> Do not contact
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="font-medium">Stop all contact with this company?</div>
          <p className="text-muted">Pending messages to anyone here are cancelled now.</p>
          <input
            className="input h-9 w-full"
            placeholder="Why? (optional)"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {message && <p className="text-danger">{message}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn h-9 border-danger/40 bg-danger text-white hover:bg-danger/90"
              disabled={busy}
              onClick={() => void suppress()}
            >
              {busy && <Loader className="size-4 animate-spin" />} Do not contact
            </button>
            <button type="button" className="btn btn-ghost h-9" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
