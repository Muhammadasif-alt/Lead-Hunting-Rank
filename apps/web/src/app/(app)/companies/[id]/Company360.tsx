"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  CircleAlert,
  Copy,
  ExternalLink,
  GitMerge,
  Globe,
  Loader,
  Pencil,
  Phone,
  ScanSearch,
} from "lucide-react";
import { ApiError, api, errorMessage, patch, post } from "@/lib/api";
import { FRESHNESS, STATUS_LABEL, formatAgo, formatDate, formatPhone, location, type Overview } from "@/lib/crm";
import { ActivityTab, ContactList, EvidenceTab, IntelligenceTab, PeopleTab, Section } from "./sections";

type Tab = "overview" | "people" | "intelligence" | "evidence" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "people", label: "People" },
  { key: "intelligence", label: "Intelligence" },
  { key: "evidence", label: "Evidence" },
  { key: "activity", label: "Activity" },
];

/** Tabs from the screen spec that later phases make real — shown honestly instead of with placeholder data. */
const LATER: { label: string; phase: number }[] = [
  { label: "Digital presence", phase: 8 },
  { label: "Conversations", phase: 11 },
  { label: "Opportunities", phase: 12 },
  { label: "Memory", phase: 14 },
];

/**
 * Company 360° V1 (screen #4, Phase 6). Answers: who are they, where did the data come from, who works there, how can
 * we contact them, what do we know, and how fresh is it. Buttons follow `allowedActions` from the API.
 */
export function Company360({ id }: { id: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>(`/companies/${id}`));
      setError(null);
    } catch (err) {
      setError({ message: errorMessage(err), status: err instanceof ApiError ? err.status : undefined });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" />
          {error.status === 404
            ? "This company doesn't exist in your workspace."
            : error.status === 403
              ? "You don't have permission to view companies."
              : error.message}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading company…
        </div>
      </div>
    );
  }

  const counts: Partial<Record<Tab, number>> = {
    people: data.people.filter((p) => p.isCurrent).length,
    intelligence: data.facts.length,
    evidence: data.evidence.length,
  };

  return (
    <div className="space-y-6">
      <BackLink />
      {data.mergedInto && (
        <div className="card flex flex-col gap-2 border-accent/30 bg-accent-soft px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <GitMerge className="size-4 shrink-0 text-accent" /> This record was merged into{" "}
            <strong>{data.mergedInto.displayName}</strong> on {formatDate(data.company.mergedAt)}. It is kept as
            history.
          </span>
          <Link href={`/companies/${data.mergedInto.id}`} className="btn btn-secondary h-8 self-start">
            Open surviving record
          </Link>
        </div>
      )}

      <Header data={data} onChange={load} />

      {data.duplicates.length > 0 && (
        <div className="card border-amber/40 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              <Copy className="mt-0.5 size-4 shrink-0 text-amber" />
              <div>
                <span className="font-medium">
                  {data.duplicates.length === 1
                    ? "Possible duplicate"
                    : `${data.duplicates.length} possible duplicates`}
                </span>
                <span className="text-muted">
                  {" "}
                  —{" "}
                  {data.duplicates.map((d, i) => (
                    <span key={d.candidateId}>
                      {i > 0 && ", "}
                      {d.other ? (
                        <Link href={`/companies/${d.other.id}`} className="hover:underline">
                          {d.other.displayName}
                        </Link>
                      ) : (
                        "unknown record"
                      )}{" "}
                      ({d.confidence.toLowerCase()})
                    </span>
                  ))}
                </span>
              </div>
            </div>
            <Link href="/companies/duplicates" className="btn btn-secondary h-8 self-start sm:self-auto">
              Review
            </Link>
          </div>
        </div>
      )}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key ? "border-tone text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {t.label}
              {counts[t.key] !== undefined && <span className="text-xs text-faint tabular-nums">{counts[t.key]}</span>}
            </button>
          ))}
          {LATER.map((t) => (
            <span
              key={t.label}
              title={`Arrives in Phase ${t.phase}`}
              className="flex cursor-default items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm text-faint"
            >
              {t.label} <span className="text-[10px]">P{t.phase}</span>
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error.message}
        </div>
      )}

      {tab === "overview" && <OverviewTab data={data} onChange={load} />}
      {tab === "people" && <PeopleTab data={data} onChange={load} />}
      {tab === "intelligence" && <IntelligenceTab data={data} onChange={load} />}
      {tab === "evidence" && <EvidenceTab data={data} />}
      {tab === "activity" && <ActivityTab companyId={data.company.id} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Companies
    </Link>
  );
}

function Header({ data, onChange }: { data: Overview; onChange: () => Promise<void> }) {
  const c = data.company;
  const a = data.allowedActions;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function act(action: "archive" | "restore" | "detect") {
    if (
      action === "archive" &&
      !window.confirm(`Archive ${c.displayName}? It leaves lists and duplicate checks; nothing is deleted.`)
    )
      return;
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      if (action === "detect") {
        const res = await post<{ openDuplicates: number }>(`/companies/${c.id}/detect-duplicates`);
        setNotice(res.openDuplicates ? `${res.openDuplicates} possible duplicate(s) to review` : "No duplicates found");
      } else await post(`/companies/${c.id}/${action}`, { version: c.version });
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const q = data.quality;
  const fresh = q.freshness ? FRESHNESS[q.freshness] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-tone/20 bg-tone-soft">
            <Building2 className="size-6 text-tone" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{c.displayName}</h1>
              <span className="badge">{STATUS_LABEL[c.status]}</span>
            </div>
            <div className="mt-1 text-sm text-muted">
              {[c.industry, location(c)].filter(Boolean).join(" · ") || "Industry and location not recorded yet"}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {c.websiteDomain ? (
                <a
                  href={`https://${c.websiteDomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent hover:underline"
                >
                  <Globe className="size-3.5" /> {c.websiteDomain} <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-faint">
                  <Globe className="size-3.5" /> No website on record
                </span>
              )}
              {c.phone && (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <Phone className="size-3.5" /> {formatPhone(c.phone)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a.findDuplicates && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => void act("detect")}
            >
              {busy === "detect" ? <Loader className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} Find
              duplicates
            </button>
          )}
          {a.archive && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy !== null}
              onClick={() => void act("archive")}
            >
              <Archive className="size-4" /> Archive
            </button>
          )}
          {a.restore && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => void act("restore")}
            >
              <ArchiveRestore className="size-4" /> Restore
            </button>
          )}
        </div>
      </div>
      {(error || notice) && <p className={`text-sm ${error ? "text-danger" : "text-muted"}`}>{error ?? notice}</p>}

      {/* Score blocks: only Data quality is real in Phase 6 — the AI scores arrive with their phases, never faked. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ScoreBlock label="ICP fit" pending="Scored in Phase 9" />
        <ScoreBlock label="Opportunity" pending="Research in Phase 8" />
        <ScoreBlock label="Intent" pending="Signals in Phase 15" />
        <div className="card p-4">
          <div className="text-xs text-muted">Data quality</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{q.evidenceCount}</span>
            <span className="text-xs text-muted">evidence</span>
            {fresh && (
              <span className={`badge ${fresh.className}`} title={fresh.hint}>
                {fresh.label}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-faint">
            {q.conflictedFacts > 0 ? (
              <span className="text-amber">{q.conflictedFacts} facts need verification</span>
            ) : q.lastObservedAt ? (
              `last observed ${formatAgo(q.lastObservedAt)}`
            ) : (
              "no sources yet"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBlock({ label, pending }: { label: string; pending: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-faint">Not scored</div>
      <div className="mt-0.5 text-xs text-faint">{pending}</div>
    </div>
  );
}

// ── Overview tab ────────────────────────────────────────────────────────────────────────────────

const DETAIL_FIELDS = [
  { key: "displayName", label: "Name" },
  { key: "legalName", label: "Legal name" },
  { key: "industry", label: "Industry" },
  { key: "website", label: "Website" },
  { key: "phone", label: "Main phone" },
  { key: "addressLine", label: "Address" },
  { key: "city", label: "City" },
  { key: "region", label: "State / region" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
] as const;

type DetailKey = (typeof DETAIL_FIELDS)[number]["key"];

function detailValues(c: Overview["company"]): Record<DetailKey, string> {
  return {
    displayName: c.displayName,
    legalName: c.legalName ?? "",
    industry: c.industry ?? "",
    website: c.websiteDomain ?? "",
    phone: formatPhone(c.phone) ?? "",
    addressLine: c.addressLine ?? "",
    city: c.city ?? "",
    region: c.region ?? "",
    postalCode: c.postalCode ?? "",
    country: c.country ?? "",
  };
}

function OverviewTab({ data, onChange }: { data: Overview; onChange: () => Promise<void> }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-6">
        <Details data={data} onChange={onChange} />
        <Section
          title="Company contact points"
          hint="Main lines and shared inboxes. People's own contacts are on the People tab."
        >
          <ContactList
            points={data.contactPoints}
            addPath={`/companies/${data.company.id}/contact-points`}
            canManage={data.allowedActions.manageContacts}
            onChange={onChange}
          />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Where the data came from">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Record created</dt>
              <dd className="mt-0.5">
                {formatDate(data.company.createdAt)} by {data.company.createdBy?.name ?? "the system"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Sources</dt>
              <dd className="mt-1">
                {data.sources.length === 0 ? (
                  <span className="text-muted">No evidence recorded yet.</span>
                ) : (
                  <ul className="space-y-1.5">
                    {data.sources.map((s) => (
                      <li key={s.source} className="flex items-center justify-between gap-3">
                        <span className="truncate">{s.source}</span>
                        <span className="shrink-0 text-xs text-muted">
                          {s.count} · {formatAgo(s.lastObservedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {data.externalIds.length > 0 && (
              <div>
                <dt className="text-xs text-faint">Provider records</dt>
                <dd className="mt-1 space-y-1">
                  {data.externalIds.map((x) => (
                    <div key={x.id} className="flex items-center justify-between gap-3">
                      <span className="truncate">{x.provider}</span>
                      <span className="truncate font-mono text-xs text-muted">{x.externalId}</span>
                    </div>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </Section>

        <Section
          title="Also known as"
          hint="Names, websites and phones that resolve to this record — used to catch duplicates."
        >
          {data.aliases.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {data.aliases.map((al) => (
                <li
                  key={al.id}
                  className="badge"
                  title={al.source?.startsWith("merge:") ? "From a merged record" : (al.source ?? undefined)}
                >
                  <span className="text-faint">{al.type.toLowerCase()}</span> {al.normalizedValue}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {data.mergedFrom.length > 0 && (
          <Section title="Merged records" hint="Earlier duplicates folded into this one. Their history stays readable.">
            <ul className="space-y-1.5 text-sm">
              {data.mergedFrom.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <Link href={`/companies/${m.id}`} className="truncate hover:underline">
                    {m.displayName}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">{formatDate(m.mergedAt)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Details({ data, onChange }: { data: Overview; onChange: () => Promise<void> }) {
  const c = data.company;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => detailValues(c));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setForm(detailValues(c));
  }, [c, editing]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const before = detailValues(c);
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v.trim() !== before[k as DetailKey]));
    if (Object.keys(changed).length === 0) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await patch(`/companies/${c.id}`, { version: c.version, ...changed });
      await onChange();
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "Someone else changed this company. Reload to see their changes."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Business details"
      action={
        data.allowedActions.edit &&
        !editing && (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost h-8 px-3">
            <Pencil className="size-3.5" /> Edit
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {DETAIL_FIELDS.map((f) => (
              <label key={f.key} className={f.key === "displayName" || f.key === "addressLine" ? "sm:col-span-2" : ""}>
                <span className="mb-1 block text-xs font-medium text-muted">{f.label}</span>
                <input
                  className="input"
                  value={form[f.key]}
                  required={f.key === "displayName"}
                  maxLength={f.key === "country" ? 2 : undefined}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Loader className="size-4 animate-spin" />} Save
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {DETAIL_FIELDS.filter((f) => f.key !== "displayName").map((f) => {
            const value = detailValues(c)[f.key];
            return (
              <div key={f.key} className="min-w-0">
                <dt className="text-xs text-faint">{f.label}</dt>
                <dd className={`mt-0.5 break-words ${value ? "" : "text-faint"}`}>{value || "Unknown"}</dd>
              </div>
            );
          })}
        </dl>
      )}
      <p className="mt-4 text-xs text-faint">
        Typed-in details are not evidence. Record where you saw something on the Intelligence tab so it carries a source
        and date.
      </p>
    </Section>
  );
}
