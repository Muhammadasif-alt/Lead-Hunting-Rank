"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Building2, Clock, FileSearch, Flame, Loader, Radar, Star } from "lucide-react";
import { RECOMMENDED_ACTION_INFO, RELATIONSHIP_INFO, SIGNAL_STATUS_INFO, type SignalRow, type SignalStrengthKey } from "@revenue-os/shared";
import { api, errorMessage } from "@/lib/api";
import { STATUS_STYLE, STRENGTH_LABEL, STRENGTH_STYLE, levelText, timeAgo } from "@/lib/signals";

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
      <Loader className="size-4 animate-spin" /> {text}
    </div>
  );
}

export function Empty({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="card px-4 py-8 text-center text-sm text-muted">
      <p>{text}</p>
      {children}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{text}</p>;
}

/** Fetch a path and render its data; `reload` refetches. */
export function Loaded<T>({ path, children }: { path: string; children: (data: T, reload: () => void) => ReactNode }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [path]);
  useEffect(() => void load(), [load]);
  if (error) return <ErrorBox text={error} />;
  if (!data) return <Loading />;
  return <>{children(data, () => void load())}</>;
}

export function useAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      onDone();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

export function StrengthBadge({ strength }: { strength: SignalStrengthKey }) {
  return (
    <span className={`badge text-[10px] font-semibold tracking-wide uppercase ${STRENGTH_STYLE[strength]}`}>
      {strength === "STRONG" && <Flame className="size-3" />}
      {STRENGTH_LABEL[strength]}
    </span>
  );
}

export function WindowBadge({ s }: { s: Pick<SignalRow, "windowState" | "windowEndsAt"> }) {
  if (!s.windowState) return null;
  return s.windowState === "ACTIVE" ? (
    <span className="badge border-tone/30 bg-tone-soft text-[10px] text-tone" title={s.windowEndsAt ? `Window ends ${new Date(s.windowEndsAt).toLocaleDateString()}` : undefined}>
      <Clock className="size-3" /> Active window
    </span>
  ) : (
    <span className="badge border-danger/30 bg-danger-soft text-[10px] text-danger">
      <Clock className="size-3" /> Window passed
    </span>
  );
}

export function StatusBadge({ status }: { status: SignalRow["status"] }) {
  return (
    <span className={`badge text-[10px] ${STATUS_STYLE[status] ?? ""}`} title={SIGNAL_STATUS_INFO[status].description}>
      {SIGNAL_STATUS_INFO[status].label}
    </span>
  );
}

/** What makes the signal relevant to us: matched approved services, else the commercial reason (never invented). */
export function relevanceText(s: SignalRow): string {
  if (s.relevance.matchedServices.length) return `${s.relevance.matchedServices.join(", ")} could be relevant.`;
  return s.relevance.reasons.find((r) => /sell|service|first-party|negative/i.test(r)) ?? `Commercial relevance ${s.relevance.commercialRelevance.toLowerCase()}.`;
}

function Row({ label, tag, children }: { label: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
        {label} {tag}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

/** Signal action card (screen #9 §46): fact and interpretation apart, relationship, why-now and the recommended action. */
export function SignalCard({ s, rank, showCompany = true }: { s: SignalRow; rank?: number; showCompany?: boolean }) {
  const rec = RECOMMENDED_ACTION_INFO[s.recommendedAction];
  return (
    <article className={`card space-y-3 p-4 ${s.strength === "STRONG" ? "border-danger/25" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {rank !== undefined && <span className="text-xs font-semibold text-faint tabular-nums">{rank}.</span>}
        <StrengthBadge strength={s.strength} />
        <span className="badge text-[10px]">{s.typeLabel}</span>
        <StatusBadge status={s.status} />
        <WindowBadge s={s} />
        {s.priority && (
          <span className="badge border-tone/30 bg-tone-soft text-[10px] text-tone">
            <Star className="size-3" /> Priority
          </span>
        )}
        {s.campaignCandidate && <span className="badge border-accent/30 bg-accent-soft text-[10px] text-accent">Campaign candidate</span>}
        <span className="ml-auto text-xs text-faint">{timeAgo(s.detectedAt)}</span>
      </div>

      <div className="min-w-0">
        {showCompany && (
          <Link href={`/companies/${s.companyId}`} className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold hover:text-tone">
            <Building2 className="size-3.5 shrink-0 text-faint" /> <span className="truncate">{s.company}</span>
          </Link>
        )}
        {showCompany && (s.industry || s.city) && <span className="ml-1.5 text-xs text-faint">{[s.industry, s.city].filter(Boolean).join(" · ")}</span>}
        <Link href={`/signals/${s.id}`} className="mt-0.5 block text-base font-medium break-words hover:text-tone">
          {s.title}
        </Link>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Row label="What happened" tag={<span className="badge h-4 border-tone/30 bg-tone-soft px-1.5 text-[9px] text-tone">Fact</span>}>
          {s.fact}
        </Row>
        <Row
          label="Why it matters"
          tag={
            s.interpretation ? (
              <span className="badge h-4 border-amber/30 bg-amber-soft px-1.5 text-[9px] text-amber">{s.interpretationSource === "AI" ? "AI hypothesis" : "Rule interpretation"}</span>
            ) : null
          }
        >
          {s.interpretation ? <span className="text-muted">{s.interpretation}</span> : <span className="text-faint">Not interpreted yet — a fact only.</span>}
        </Row>
        <Row label="Our relevance">
          <span className="text-muted">{relevanceText(s)}</span>
        </Row>
        <div className="grid grid-cols-2 gap-3">
          <Row label="Relationship">
            <span title={RELATIONSHIP_INFO[s.relationship].description}>{RELATIONSHIP_INFO[s.relationship].label}</span>
          </Row>
          <Row label="ICP">{levelText(s.icp)}</Row>
        </div>
      </dl>

      <div className={`rounded-lg border px-3 py-2 text-sm ${s.whyNow ? "border-tone/25 bg-tone-soft" : "border-line bg-raised"}`}>
        <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">Why now · </span>
        {s.whyNow ?? <span className="text-muted">No signal-based outreach — no meaningful why-now.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1 font-medium" title={rec.description}>
          <Radar className="size-3.5 text-tone" /> {rec.label}
        </span>
        <span className="text-faint">
          {s.sourceCount} source{s.sourceCount === 1 ? "" : "s"} · {s.evidenceCount} evidence · {s.confidence.toLowerCase()} confidence
        </span>
        <Link href={`/signals/${s.id}`} className="ml-auto inline-flex items-center gap-1 text-tone hover:underline">
          <FileSearch className="size-3.5" /> Details & evidence
        </Link>
      </div>
    </article>
  );
}

export function SignalList({ rows, showCompany, ranked }: { rows: SignalRow[]; showCompany?: boolean; ranked?: boolean }) {
  return (
    <div className="space-y-3">
      {rows.map((s, i) => (
        <SignalCard key={s.id} s={s} showCompany={showCompany} rank={ranked ? i + 1 : undefined} />
      ))}
    </div>
  );
}

/** Small list row (company tab, deal card). */
export function SignalMini({ s }: { s: SignalRow }) {
  return (
    <Link href={`/signals/${s.id}`} className="flex items-start gap-2 rounded-lg border border-line p-2.5 hover:border-line-strong">
      <StrengthBadge strength={s.strength} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium break-words">{s.title}</span>
        <span className="block text-xs text-faint">
          {s.typeLabel} · {timeAgo(s.detectedAt)}
          {s.windowState === "ACTIVE" ? " · active window" : s.windowState === "PASSED" ? " · window passed" : ""}
        </span>
      </span>
    </Link>
  );
}

/** Opportunity detail (screen #9 §26): open signals of the deal's company belong on the deal — never a new cold email. */
export function DealSignals({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<SignalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ items: SignalRow[]; total: number }>(`/signals/list?companyId=${encodeURIComponent(companyId)}&status=OPEN`)
      .then((r) => setRows(r.items))
      .catch((err) => setError(errorMessage(err)));
  }, [companyId]);
  return (
    <section className="card space-y-2 p-4 text-sm" data-tone="leads">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow text-[11px]">Signals</div>
        <Link href={`/companies/${companyId}?tab=signals`} className="text-xs text-muted hover:text-tone">
          All for company
        </Link>
      </div>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : !rows ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader className="size-3.5 animate-spin" /> Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">No open signals for this company.</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 5).map((s) => (
            <SignalMini key={s.id} s={s} />
          ))}
          {rows.length > 5 && <p className="text-xs text-faint">+{rows.length - 5} more</p>}
        </div>
      )}
      <p className="text-[11px] text-faint">Signals attach to the deal and the owner is told — no cold outreach while a deal is open.</p>
    </section>
  );
}
