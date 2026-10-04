"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Copy, GitMerge, Loader, X } from "lucide-react";
import { ApiError, api, errorMessage, post } from "@/lib/api";
import {
  CONFIDENCE_CLASS,
  STATUS_LABEL,
  formatAgo,
  formatPhone,
  location,
  type Company,
  type Confidence,
  type MatchSignal,
} from "@/lib/crm";
import { useMe } from "@/lib/session-context";

type Side = Company & { peopleCount: number; evidenceCount: number };

interface Candidate {
  id: string;
  version: number;
  status: "PENDING" | "NEEDS_REVIEW" | "AUTO_RESOLVED" | "MERGED" | "REJECTED";
  score: number;
  confidence: Confidence;
  matching: MatchSignal[];
  conflicting: MatchSignal[];
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  left: Side | null;
  right: Side | null;
}

interface Page {
  items: Candidate[];
  nextCursor: string | null;
  openCount: number;
}

const RESOLVED_LABEL: Record<string, string> = {
  MERGED: "Merged",
  REJECTED: "Not the same business",
  AUTO_RESOLVED: "Closed by the system",
};

/** `identity` rows are the ones where two different values mean the records may really be different businesses. */
const COMPARE: { label: string; identity?: boolean; get: (c: Side) => string | null }[] = [
  { label: "Website", identity: true, get: (c) => c.websiteDomain },
  { label: "Phone", identity: true, get: (c) => formatPhone(c.phone) },
  { label: "Address", identity: true, get: (c) => c.addressLine },
  { label: "Location", get: (c) => location(c) || null },
  { label: "Industry", get: (c) => c.industry },
  { label: "Status", get: (c) => STATUS_LABEL[c.status] },
  { label: "People", get: (c) => String(c.peopleCount) },
  { label: "Evidence", get: (c) => String(c.evidenceCount) },
  { label: "Created", get: (c) => formatAgo(c.createdAt) },
];

/**
 * Duplicate review (docs/17 §40-45). Entity resolution proposes; a human decides which record survives or that they
 * are different businesses. A merge moves everything to the survivor and keeps the other record as history.
 */
export function Duplicates() {
  const me = useMe();
  const canDecide = me.permissions.includes("company.merge");
  const [view, setView] = useState<"open" | "resolved">("open");
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      try {
        const res = await api<Page>(`/duplicates?view=${view}&limit=20${after ? `&cursor=${after}` : ""}`);
        setPage((prev) => (after && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [view],
  );

  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Companies
      </Link>
      <div className="relative flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <span aria-hidden="true" className="absolute -bottom-px left-0 h-0.5 w-16 rounded-full bg-tone" />
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-tone/20 bg-tone-soft">
            <Copy className="size-5 text-tone" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Duplicate review</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
              Records that may be the same business. Nothing is merged without a decision — only exact, conflict-free
              matches from automated imports are folded together on their own.
            </p>
          </div>
        </div>
        <div className="flex gap-1 self-start rounded-full border border-line bg-surface p-1 sm:self-auto">
          {(["open", "resolved"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${view === v ? "bg-tone-soft text-tone" : "text-muted hover:text-fg"}`}
            >
              {v === "open" ? `To review${page && view === "open" ? ` (${page.openCount})` : ""}` : "Decided"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}

      {page === null ? (
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </div>
      ) : page.items.length === 0 ? (
        <div className="card flex items-center gap-3 px-5 py-6 text-sm text-muted">
          <Check className="size-4 shrink-0 text-brand" />
          {view === "open" ? "No possible duplicates waiting for review." : "No decisions yet."}
        </div>
      ) : (
        <div className="space-y-4">
          {page.items.map((c) => (
            <CandidateCard key={c.id} c={c} canDecide={canDecide && view === "open"} onDone={() => load()} />
          ))}
          {page.nextCursor && (
            <div className="flex justify-center">
              <button type="button" className="btn btn-secondary" onClick={() => void load(page.nextCursor!)}>
                Load more
              </button>
            </div>
          )}
        </div>
      )}
      {!canDecide && view === "open" && (
        <p className="text-xs text-faint">
          You can see possible duplicates; merging needs the company.merge permission.
        </p>
      )}
    </div>
  );
}

function CandidateCard({ c, canDecide, onDone }: { c: Candidate; canDecide: boolean; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!c.left || !c.right) return null;
  const left = c.left;
  const right = c.right;

  async function merge(target: Side, source: Side) {
    const ok = window.confirm(
      `Keep “${target.displayName}” and merge “${source.displayName}” into it?\n\n` +
        "People, contact details, evidence and facts move to the kept record. Empty fields are filled, nothing is overwritten, " +
        "and disagreeing facts are flagged for verification. The other record stays as read-only history.",
    );
    if (!ok) return;
    await decide(`merge-${target.id}`, () =>
      post(`/duplicates/${c.id}/merge`, { targetId: target.id, version: c.version }),
    );
  }

  async function decide(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 409 || err.status === 422) ? `${err.message}` : errorMessage(err),
      );
      setBusy(null);
    }
  }

  const differs = (get: (s: Side) => string | null) => {
    const a = get(left);
    const b = get(right);
    return !!a && !!b && a.toLowerCase() !== b.toLowerCase();
  };

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised px-5 py-3">
        <span className={`badge ${CONFIDENCE_CLASS[c.confidence]}`}>{c.confidence.toLowerCase()} confidence</span>
        <span className="text-xs text-muted tabular-nums">score {c.score}/100</span>
        <span className="text-xs text-faint">· detected {formatAgo(c.detectedAt)}</span>
        {c.resolvedAt && (
          <span className="badge ml-auto">
            {RESOLVED_LABEL[c.status] ?? c.status} · {formatAgo(c.resolvedAt)}
          </span>
        )}
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px] sm:text-sm">
            <thead>
              <tr className="text-left">
                <th className="w-20 pb-2 text-xs font-medium text-faint sm:w-24" />
                {[left, right].map((s) => (
                  <th key={s.id} className="pb-2 pr-3 align-bottom [overflow-wrap:anywhere]">
                    <Link href={`/companies/${s.id}`} className="font-semibold hover:underline">
                      {s.displayName}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COMPARE.map((row) => {
                const diff = !!row.identity && differs(row.get);
                return (
                  <tr key={row.label}>
                    <td className="py-1.5 text-xs text-faint">{row.label}</td>
                    {[left, right].map((s) => {
                      const v = row.get(s);
                      return (
                        <td
                          key={s.id}
                          className={`py-1.5 pr-3 [overflow-wrap:anywhere] ${v ? (diff ? "text-amber" : "") : "text-faint"}`}
                        >
                          {v ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <div className="mb-1 font-medium text-muted">Why they may match</div>
            <ul className="space-y-1">
              {c.matching.map((m) => (
                <li key={m.detail} className="flex gap-1.5 text-brand">
                  <Check className="mt-0.5 size-3.5 shrink-0" /> <span className="text-fg">{m.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          {c.conflicting.length > 0 && (
            <div>
              <div className="mb-1 font-medium text-muted">What disagrees</div>
              <ul className="space-y-1">
                {c.conflicting.map((m) => (
                  <li key={m.detail} className="flex gap-1.5 text-amber">
                    <X className="mt-0.5 size-3.5 shrink-0" /> <span className="text-fg">{m.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.resolution && <p className="text-muted">“{c.resolution}”</p>}
        </div>
      </div>

      {error && <p className="px-5 pb-3 text-sm text-danger">{error}</p>}
      {canDecide && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          {[
            [left, right],
            [right, left],
          ].map(([target, source]) => (
            <button
              key={target!.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void merge(target!, source!)}
              className="btn btn-secondary h-8 max-w-full"
            >
              {busy === `merge-${target!.id}` ? (
                <Loader className="size-3.5 animate-spin" />
              ) : (
                <GitMerge className="size-3.5" />
              )}
              <span className="truncate">Keep {target!.displayName}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt("Why are these different businesses? (optional)");
              if (reason === null) return;
              void decide("reject", () =>
                post(`/duplicates/${c.id}/reject`, { version: c.version, ...(reason.trim() ? { reason } : {}) }),
              );
            }}
            className="btn btn-ghost h-8 sm:ml-auto"
          >
            {busy === "reject" ? <Loader className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Not the same
            business
          </button>
        </div>
      )}
    </article>
  );
}
