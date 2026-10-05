"use client";

import { useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  FileSearch,
  Lightbulb,
  Loader,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { errorMessage, post } from "@/lib/api";
import { formatAgo, formatDate, type Overview, type ResearchRunStatus } from "@/lib/crm";
import { Section } from "./sections";

const RUN_STATUS: Record<ResearchRunStatus, { label: string; className: string }> = {
  QUEUED: { label: "Waiting to start", className: "border-line bg-raised text-muted" },
  RUNNING: { label: "Researching…", className: "border-accent/30 bg-accent-soft text-accent" },
  WAITING: { label: "Waiting on a provider", className: "border-amber/30 bg-amber-soft text-amber" },
  COMPLETED: { label: "Researched", className: "border-brand/25 bg-brand-soft text-brand" },
  PARTIAL: { label: "Partly researched", className: "border-amber/30 bg-amber-soft text-amber" },
  FAILED: { label: "Research failed", className: "border-danger/30 bg-danger-soft text-danger" },
};

const LEVEL: Record<string, { label: string; className: string }> = {
  HIGH: { label: "High", className: "text-brand" },
  MEDIUM: { label: "Medium", className: "text-amber" },
  LOW: { label: "Low", className: "text-muted" },
  NONE: { label: "None yet", className: "text-faint" },
};

const CONFIDENCE_CLASS: Record<string, string> = {
  HIGH: "border-brand/25 bg-brand-soft text-brand",
  MEDIUM: "border-amber/30 bg-amber-soft text-amber",
  LOW: "border-line bg-raised text-muted",
};

/** "/contact" for a sub-page, nothing for the home page. */
function pagePath(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    return path || "";
  } catch {
    return "";
  }
}

/** "Research now" + the latest run's state. The API says whether the button is allowed. */
export function ResearchControl({ data, onChange }: { data: Overview; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = data.research.latestRun;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await post(`/companies/${data.company.id}/research`);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <FileSearch className="mt-0.5 size-4 shrink-0 text-tone" />
        <div className="min-w-0">
          {run ? (
            <>
              <span className={`badge ${RUN_STATUS[run.status].className}`}>{RUN_STATUS[run.status].label}</span>{" "}
              <span className="text-muted">
                {run.completedAt ? formatAgo(run.completedAt) : formatAgo(run.createdAt)}
                {run.summary ? ` · ${run.summary}` : ""}
              </span>
              {run.gaps.length > 0 && !data.research.active && (
                <ul className="mt-1 list-inside list-disc text-xs text-muted">
                  {run.gaps.slice(0, 3).map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <span className="text-muted">Not researched yet — website, contacts and opportunities are unknown.</span>
          )}
          {error && <p className="mt-1 text-danger">{error}</p>}
        </div>
      </div>
      {data.allowedActions.research && (
        <button
          type="button"
          className="btn btn-secondary shrink-0 self-start sm:self-auto"
          disabled={busy || data.research.active}
          onClick={() => void start()}
        >
          {busy || data.research.active ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <FileSearch className="size-4" />
          )}
          {data.research.active ? "Researching" : run ? "Research again" : "Research now"}
        </button>
      )}
    </div>
  );
}

/** Opportunity hypotheses — clearly not facts: hedged, with their evidence, and marked when no longer supported. */
export function Hypotheses({ data, compact = false }: { data: Overview; compact?: boolean }) {
  const active = data.hypotheses.filter((h) => h.status === "ACTIVE" || h.status === "SUPPORTED");
  const old = data.hypotheses.filter((h) => !(h.status === "ACTIVE" || h.status === "SUPPORTED"));
  const list = compact ? active.slice(0, 4) : active;
  return (
    <Section
      title="Opportunity hypotheses"
      hint="Possible needs suggested by what we observed — not verified pain. Each one cites its evidence."
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">
          {data.research.latestRun ? "Nothing observed that suggests a need." : "Research this company to see them."}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((h) => (
            <li key={h.id} className="rounded-lg border border-line p-3">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{h.hypothesis}</div>
                  <div className="mt-0.5 text-xs text-muted">Why: {h.reasonSummary}</div>
                  {!compact && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-faint">
                      <span className={`badge ${CONFIDENCE_CLASS[h.confidence]}`}>
                        {h.confidence.toLowerCase()} confidence
                      </span>
                      <span>{h.source === "RULE" ? "From website checks" : "AI"}</span>
                      <span>· since {formatDate(h.generatedAt)}</span>
                      {h.evidence.slice(0, 2).map((e) => (
                        <span key={e.id} className="inline-flex min-w-0 items-center gap-1">
                          ·{" "}
                          {e.sourceUrl ? (
                            <a
                              href={e.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate hover:underline"
                            >
                              {e.sourceName ?? e.provider ?? e.sourceType}
                              {pagePath(e.sourceUrl)} ({formatAgo(e.observedAt)})
                            </a>
                          ) : (
                            <span className="truncate">
                              {e.provider ?? e.sourceName ?? e.sourceType} ({formatAgo(e.observedAt)})
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {compact && active.length > list.length && (
        <p className="mt-2 text-xs text-faint">+{active.length - list.length} more on the Digital presence tab</p>
      )}
      {!compact && old.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">{old.length} no longer supported</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {old.map((h) => (
              <li key={h.id} className="line-through decoration-faint">
                {h.hypothesis} <span className="text-xs no-underline">({h.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

/** Can we reach a relevant person? Reasons in words, never a bare score. */
export function Contactability({ data }: { data: Overview }) {
  const c = data.contactability;
  return (
    <Section title="Contactability" hint="Verified means the address exists — not that we may contact it.">
      <div className={`text-lg font-semibold ${LEVEL[c.level].className}`}>{LEVEL[c.level].label}</div>
      <ul className="mt-2 space-y-1 text-sm text-muted">
        {c.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {c.decisionMakers.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-faint">Possible decision makers</div>
          <ul className="mt-1.5 space-y-2 text-sm">
            {c.decisionMakers.slice(0, 4).map((d) => (
              <li key={d.personId} className="flex items-start gap-2">
                <UserRound className="mt-0.5 size-4 shrink-0 text-muted" />
                <div className="min-w-0">
                  <div className="truncate">
                    {d.name} <span className="text-muted">{d.title ? `· ${d.title}` : ""}</span>
                  </div>
                  <div className="text-xs text-faint">
                    Role fit {d.relevance.toLowerCase()}
                    {d.confidence === "LOW" ? " · named on the website, not verified" : ""}
                    {d.email
                      ? ` · ${d.email.value} (${d.email.status === "VERIFIED" ? "verified" : (d.email.verification?.toLowerCase().replace("_", "-") ?? "not checked")})`
                      : " · no published email"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function CheckIcon({ observed }: { observed: boolean | null }) {
  if (observed === null) return <CircleHelp className="size-4 shrink-0 text-faint" />;
  return observed ? (
    <CircleCheck className="size-4 shrink-0 text-brand" />
  ) : (
    <CircleX className="size-4 shrink-0 text-danger" />
  );
}

/** Digital presence (screen #4): website checks with the page that shows each, technology, social, pages read. */
export function DigitalPresenceTab({ data }: { data: Overview }) {
  const w = data.website;
  const run = data.research.latestRun;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-6">
        <Section
          title="Website checks"
          hint="Read directly from the website, no AI. A question mark means we could not tell — not a no."
        >
          {!w ? (
            <p className="text-sm text-muted">
              {data.company.websiteDomain
                ? run
                  ? "The website has not been read yet (see the research gaps above)."
                  : "Not researched yet."
                : "No website on record for this business."}
            </p>
          ) : w.status === "UNREACHABLE" ? (
            <div className="flex items-start gap-2 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
              <span>
                {w.domain} did not load when checked {w.lastCheckedAt ? formatAgo(w.lastCheckedAt) : ""}:{" "}
                {w.statusReason}. This can be temporary.
              </span>
            </div>
          ) : !w.audit ? (
            <p className="text-sm text-muted">No checks recorded yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {w.audit.findings.map((f) => (
                  <li key={f.key} className="flex items-start gap-3 py-2.5">
                    <CheckIcon observed={f.observed} />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{f.label}</div>
                      <div className="text-muted">{f.detail}</div>
                    </div>
                    {f.url && (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs text-accent hover:underline"
                        title={f.url}
                      >
                        page <ExternalLink className="inline size-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-faint">
                Checked {formatAgo(w.audit.performedAt)} · {w.audit.confidence.toLowerCase()} confidence (
                {w.snapshots.length} page{w.snapshots.length === 1 ? "" : "s"} read)
              </p>
            </>
          )}
        </Section>
        <Hypotheses data={data} />
      </div>

      <div className="space-y-6">
        <Section title="Technology" hint="Detected from the website's code.">
          {data.technologies.length === 0 ? (
            <p className="text-sm text-muted">None detected.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {data.technologies.map((t) => (
                <li
                  key={t.key}
                  className={`badge ${t.goneAt ? "line-through opacity-60" : ""}`}
                  title={
                    t.goneAt ? `No longer seen since ${formatDate(t.goneAt)}` : `Seen ${formatAgo(t.lastDetectedAt)}`
                  }
                >
                  <span className="text-faint">{t.category.toLowerCase()}</span> {t.name}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section
          title="Social profiles"
          hint="Linked from the official website. A profile is not proof of who runs it."
        >
          {data.socialProfiles.length === 0 ? (
            <p className="text-sm text-muted">None linked.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.socialProfiles.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`truncate hover:underline ${s.status === "GONE" ? "text-faint line-through" : ""}`}
                  >
                    {s.platform} {s.handle ? `· ${s.handle}` : ""}
                  </a>
                  <span className="shrink-0 text-xs text-faint">{formatAgo(s.lastCheckedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Pages read" hint="Snapshots kept as evidence: address, time and a fingerprint of the content.">
          {!w || w.snapshots.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {w.snapshots.map((sn) => (
                <li key={sn.id} className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <a href={sn.url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                      {sn.pageType.toLowerCase()} · {sn.title ?? sn.url}
                    </a>
                    <span className="shrink-0 text-xs text-faint">{formatAgo(sn.fetchedAt)}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-faint">
                    {Math.round(sn.byteSize / 1024)} KB{sn.truncated ? " (cut)" : ""} · sha256{" "}
                    {sn.contentHash.slice(0, 12)}
                  </div>
                  {sn.untrustedInstructions && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-amber">
                      <ShieldAlert className="size-3.5" /> Contains text aimed at bots — stored as untrusted data,
                      nothing followed.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
        {run && run.steps.length > 0 && (
          <Section
            title="Last research run"
            hint={`${run.trigger === "DISCOVERY" ? "Started by Lead Hunter" : "Started by a person"} · ${formatAgo(run.createdAt)}`}
          >
            <ul className="space-y-1.5 text-sm">
              {run.steps.map((s, i) => (
                <li key={`${s.key}-${i}`} className="flex items-start gap-2">
                  <CheckIcon observed={s.status === "DONE" ? true : s.status === "FAILED" ? false : null} />
                  <span className="min-w-0 text-muted">{s.detail}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
