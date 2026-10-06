"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, Loader, Lock, X } from "lucide-react";
import { POLICY_REASONS, type PolicyReasonCode } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { ACTION_LABEL, actorLabel, type ApprovalRow } from "@/lib/policy";

const OUTCOME_TEXT: Record<string, string> = {
  QUEUED: "Approved — queued. It is checked once more right before sending.",
  WAITING: "Approved — it waits for the sending window or limit, then is checked again.",
  BLOCKED: "Approved, but the policy still blocks it now (e.g. suppressed or outbound stopped).",
  REJECTED: "Rejected — the message was cancelled.",
  EXPIRED: "The approval had expired — the message was cancelled.",
  INVALIDATED: "The message changed after approval was asked — cancelled. A new request is needed.",
};

const STATUS_STYLE: Record<ApprovalRow["status"], string> = {
  PENDING: "border-accent/25 bg-accent-soft text-accent",
  APPROVED: "border-brand/25 bg-brand-soft text-brand",
  REJECTED: "border-danger/25 bg-danger-soft text-danger",
  EXPIRED: "",
  INVALIDATED: "border-amber/30 bg-amber-soft text-amber",
  CANCELLED: "",
};

/**
 * Approvals the Policy Engine asked for (docs/10 §76-92). The approver sees exactly what would be sent (the frozen
 * payload). Approval ≠ execution: the action is revalidated on approval and again right before sending.
 */
export function Approvals({ canDecide, onChanged }: { canDecide: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState<"PENDING" | "ALL">("PENDING");
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows(await api<ApprovalRow[]>(`/policy/approvals?status=${status}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    try {
      const note = notes[id]?.trim();
      const r = await post<{ outcome: string }>(`/policy/approvals/${id}/${decision}`, note ? { note } : {});
      setResults((prev) => ({ ...prev, [id]: OUTCOME_TEXT[r.outcome] ?? r.outcome }));
      await load();
      onChanged();
    } catch (err) {
      setResults((prev) => ({ ...prev, [id]: errorMessage(err) }));
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          The AI asks here when the policy says a person must decide. Only people can approve.
        </p>
        <div className="flex gap-1 rounded-lg border border-line p-1 text-sm">
          {(["PENDING", "ALL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`rounded-md px-3 py-1 ${status === s ? "bg-tone-soft text-tone" : "text-muted hover:bg-hover"}`}
              onClick={() => setStatus(s)}
            >
              {s === "PENDING" ? "Waiting" : "All"}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      {Object.entries(results)
        .filter(([id]) => !rows?.some((r) => r.id === id && r.status === "PENDING"))
        .map(([id, text]) => (
          <div key={id} className="card px-4 py-3 text-sm">
            {text}
          </div>
        ))}
      {!rows ? (
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="card px-5 py-4 text-sm text-muted">
          {status === "PENDING" ? "Nothing is waiting for approval." : "No approval requests yet."} Requests appear when
          an AI agent wants to send and the autonomy level or a rule says a person decides — the Campaign and
          Conversation agents arrive with the next phases.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{ACTION_LABEL[r.actionType] ?? r.actionType}</span>
                    <span className="text-xs text-muted">asked by {actorLabel(r.requestedBy)}</span>
                    {r.entity.type === "COMPANY" && r.entity.name && (
                      <Link href={`/companies/${r.entity.id}`} className="text-xs text-accent hover:underline">
                        {r.entity.name}
                      </Link>
                    )}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm text-muted">
                    {r.reasonCodes.map((c) => (
                      <li key={c}>· {POLICY_REASONS[c as PolicyReasonCode] ?? c}</li>
                    ))}
                  </ul>
                </div>
                <div className="text-right text-xs text-faint">
                  <span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status.toLowerCase()}</span>
                  <div className="mt-1">
                    {r.status === "PENDING"
                      ? `expires ${formatAgo(r.expiresAt).replace(" ago", "")}`
                      : r.decidedAt
                        ? `${r.decidedBy ?? "system"} · ${formatAgo(r.decidedAt)}`
                        : formatAgo(r.createdAt)}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-line bg-raised p-3 text-sm">
                <div className="text-xs text-faint">To: {r.preview.to.join(", ") || "—"}</div>
                {r.preview.subject && <div className="mt-1 font-medium">{r.preview.subject}</div>}
                {r.preview.text && (
                  <p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted">
                    {r.preview.text}
                  </p>
                )}
              </div>
              {r.decisionNote && <p className="mt-2 text-xs text-muted">Note: {r.decisionNote}</p>}

              {r.status === "PENDING" &&
                (canDecide ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <input
                      className="input h-9 min-w-0 flex-1 sm:max-w-xs"
                      placeholder="Note (optional)"
                      value={notes[r.id] ?? ""}
                      maxLength={1000}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn btn-primary h-9"
                      disabled={busy === r.id}
                      onClick={() => void decide(r.id, "approve")}
                    >
                      {busy === r.id ? <Loader className="size-4 animate-spin" /> : <Check className="size-4" />}{" "}
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary h-9"
                      disabled={busy === r.id}
                      onClick={() => void decide(r.id, "reject")}
                    >
                      <X className="size-4" /> Reject
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-faint">
                    <Lock className="size-3.5" /> You can&apos;t decide approvals with your role
                  </p>
                ))}
              {results[r.id] && r.status === "PENDING" && <p className="mt-2 text-sm text-danger">{results[r.id]}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
