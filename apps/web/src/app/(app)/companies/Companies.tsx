"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CircleAlert, Copy, Loader, Plus, Search, Users, X } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import {
  CONFIDENCE_CLASS,
  FRESHNESS,
  STATUS_LABEL,
  formatAgo,
  location,
  type Company,
  type CompanyRow,
  type CompanyStatus,
  type Confidence,
  type MatchSignal,
} from "@/lib/crm";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

interface ListResponse {
  items: CompanyRow[];
  nextCursor: string | null;
  hasMore: boolean;
  statusCounts: Partial<Record<CompanyStatus, number>>;
}

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All active records" },
  ...(Object.keys(STATUS_LABEL) as CompanyStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

/** Companies (screen #4 list, Phase 6): the canonical record of every business, with honest freshness and duplicates. */
export function Companies() {
  const me = useMe();
  const canRead = me.permissions.includes("company.read");
  const canCreate = me.permissions.includes("company.update");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (q: string, s: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: "25" });
    if (q.trim()) params.set("search", q.trim());
    if (s) params.set("status", s);
    if (cursor) params.set("cursor", cursor);
    try {
      const res = await api<ListResponse>(`/companies?${params}`);
      setData((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!canRead) return;
    const t = setTimeout(() => void load(search, status), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [canRead, load, search, status]);

  useEffect(() => {
    if (!canRead) return;
    api<{ openCount: number }>("/duplicates?limit=1")
      .then((d) => setDuplicates(d.openCount))
      .catch(() => setDuplicates(null));
  }, [canRead]);

  const screen = findScreen("/companies");
  const total = data ? Object.values(data.statusCounts).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        screen={screen}
        actions={
          canRead && (
            <>
              {duplicates !== null && duplicates > 0 && (
                <Link href="/companies/duplicates" className="btn btn-secondary">
                  <Copy className="size-4" /> Duplicates{" "}
                  <span className="badge h-5 px-1.5 text-amber">{duplicates}</span>
                </Link>
              )}
              {canCreate && (
                <button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
                  <Plus className="size-4" /> Add company
                </button>
              )}
            </>
          )
        }
      />

      {!canRead ? (
        <div className="card px-5 py-4 text-sm text-muted">You don&apos;t have permission to view companies.</div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">Search companies</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                className="input pl-9"
                placeholder="Search name, website, phone or city"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="sm:w-56">
              <span className="sr-only">Status</span>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                    {f.value && data?.statusCounts[f.value as CompanyStatus]
                      ? ` (${data.statusCounts[f.value as CompanyStatus]})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <CircleAlert className="size-4 shrink-0" /> {error}
            </div>
          )}

          {data === null ? (
            <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
              <Loader className="size-4 animate-spin" /> Loading…
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState
              filtered={!!search || !!status}
              hasAny={total > 0}
              canCreate={canCreate}
              onAdd={() => setAdding(true)}
            />
          ) : (
            <>
              <CompanyTable rows={data.items} />
              {data.hasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={loadingMore}
                    onClick={async () => {
                      setLoadingMore(true);
                      await load(search, status, data.nextCursor ?? undefined);
                      setLoadingMore(false);
                    }}
                  >
                    {loadingMore && <Loader className="size-4 animate-spin" />} Load more
                  </button>
                </div>
              )}
            </>
          )}

          <p className="text-xs leading-relaxed text-faint">
            Each business has one canonical record. Likely duplicates go to review — they are never merged blindly, and
            a merge keeps every source. Freshness comes from when evidence was last observed, not from when a row was
            edited.
          </p>
        </>
      )}

      {adding && <AddCompanyDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function EmptyState({
  filtered,
  hasAny,
  canCreate,
  onAdd,
}: {
  filtered: boolean;
  hasAny: boolean;
  canCreate: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-tone/20 bg-tone-soft">
        <Building2 className="size-6 text-tone" />
      </span>
      <h2 className="mt-4 text-base font-semibold">
        {filtered && hasAny ? "No matching companies" : "No companies yet"}
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted">
        {filtered && hasAny
          ? "Try a different search or status."
          : "Add a company by hand now. From Phase 7, Lead Hunter discovers whole markets and fills this list automatically — de-duplicated, with sources."}
      </p>
      {canCreate && !(filtered && hasAny) && (
        <button type="button" onClick={onAdd} className="btn btn-primary mt-5">
          <Plus className="size-4" /> Add company
        </button>
      )}
    </div>
  );
}

function CompanyTable({ rows }: { rows: CompanyRow[] }) {
  return (
    <div className="card overflow-hidden">
      {/* Desktop: table */}
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-line bg-raised text-left text-xs text-muted">
          <tr>
            <th className="px-5 py-2.5 font-medium">Company</th>
            <th className="px-3 py-2.5 font-medium">Location</th>
            <th className="px-3 py-2.5 font-medium">People</th>
            <th className="px-3 py-2.5 font-medium">Evidence</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-5 py-2.5 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.id} className="relative hover:bg-hover/60">
              <td className="px-5 py-3">
                <Link href={`/companies/${c.id}`} className="font-medium after:absolute after:inset-0">
                  {c.displayName}
                </Link>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  {c.websiteDomain ?? <span className="text-faint">No website on record</span>}
                  {c.openDuplicates > 0 && <DuplicateBadge count={c.openDuplicates} />}
                </div>
              </td>
              <td className="px-3 py-3 text-muted">{location(c) || <span className="text-faint">—</span>}</td>
              <td className="px-3 py-3 tabular-nums text-muted">{c.peopleCount}</td>
              <td className="px-3 py-3">
                <EvidenceCell row={c} />
              </td>
              <td className="px-3 py-3">
                <span className="badge">{STATUS_LABEL[c.status]}</span>
              </td>
              <td className="px-5 py-3 text-right text-xs text-faint">{formatAgo(c.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: list */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((c) => (
          <li key={c.id}>
            <Link href={`/companies/${c.id}`} className="block px-4 py-3.5 hover:bg-hover/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.displayName}</div>
                  <div className="truncate text-xs text-muted">
                    {[c.websiteDomain, location(c)].filter(Boolean).join(" · ") || "No website or location yet"}
                  </div>
                </div>
                <span className="badge shrink-0">{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3.5" /> {c.peopleCount}
                </span>
                <EvidenceCell row={c} />
                {c.openDuplicates > 0 && <DuplicateBadge count={c.openDuplicates} />}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceCell({ row }: { row: CompanyRow }) {
  if (!row.evidenceCount) return <span className="text-xs text-faint">No evidence yet</span>;
  const f = row.freshness ? FRESHNESS[row.freshness] : null;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className="tabular-nums">{row.evidenceCount}</span>
      {f && (
        <span className={`badge ${f.className}`} title={f.hint}>
          {f.label}
        </span>
      )}
    </span>
  );
}

function DuplicateBadge({ count }: { count: number }) {
  return (
    <span className="badge relative z-10 border-amber/30 bg-amber-soft text-amber">
      <Copy className="size-3" /> {count === 1 ? "Possible duplicate" : `${count} possible duplicates`}
    </span>
  );
}

// ── Add company ─────────────────────────────────────────────────────────────────────────────────

interface Match {
  company: Company;
  score: number;
  confidence: Confidence;
  matching: MatchSignal[];
  conflicting: MatchSignal[];
}

const EMPTY = { displayName: "", website: "", phone: "", industry: "", city: "", region: "", country: "" };

function AddCompanyDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = useCallback(
    () => Object.fromEntries(Object.entries(form).filter(([k, v]) => k === "displayName" || v.trim())),
    [form],
  );

  // Live duplicate check while typing (no writes).
  useEffect(() => {
    if (form.displayName.trim().length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      post<Match[]>("/companies/check-duplicates", body())
        .then(setMatches)
        .catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(t);
  }, [body, form.displayName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ company: Company }>("/companies", body());
      router.push(`/companies/${res.company.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const field = (key: keyof typeof EMPTY, label: string, placeholder = "", extra: { maxLength?: number } = {}) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        ref={key === "displayName" ? first : undefined}
        className="input"
        value={form[key]}
        placeholder={placeholder}
        required={key === "displayName"}
        {...extra}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add company"
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <form
        onSubmit={submit}
        className="card relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-[var(--radius-card)] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Add company</h2>
            <p className="mt-0.5 text-xs text-muted">Website and phone help us spot duplicates before they happen.</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost -mt-1 -mr-2 px-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("displayName", "Company name", "GreenScape Landscaping")}</div>
          {field("website", "Website", "greenscape.com")}
          {field("phone", "Phone", "(512) 555-0100")}
          {field("industry", "Industry", "Landscaping")}
          {field("city", "City", "Austin")}
          {field("region", "State / region", "TX")}
          {field("country", "Country (2-letter)", "US", { maxLength: 2 })}
        </div>

        {matches.length > 0 && (
          <div className="mt-5 rounded-xl border border-amber/30 bg-amber-soft/50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber">
              <Copy className="size-4" /> This may already exist
            </div>
            <ul className="mt-3 space-y-2">
              {matches.slice(0, 3).map((m) => (
                <li key={m.company.id} className="rounded-lg border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/companies/${m.company.id}`} className="text-sm font-medium hover:underline">
                      {m.company.displayName}
                    </Link>
                    <span className={`badge ${CONFIDENCE_CLASS[m.confidence]}`}>
                      {m.confidence.toLowerCase()} match
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">{m.matching.map((s) => s.detail).join(" · ")}</div>
                  {m.conflicting.length > 0 && (
                    <div className="mt-0.5 text-xs text-amber">{m.conflicting.map((s) => s.detail).join(" · ")}</div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Open the existing record instead — or add anyway and it will be listed for duplicate review.
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy || !form.displayName.trim()} className="btn btn-primary">
            {busy && <Loader className="size-4 animate-spin" />} {matches.length ? "Add anyway" : "Add company"}
          </button>
        </div>
      </form>
    </div>
  );
}
