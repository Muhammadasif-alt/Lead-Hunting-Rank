"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Link2,
  Loader,
  Mail,
  Phone,
  Plus,
  Star,
  Trash2,
  User,
  UserMinus,
  Users,
  Wrench,
} from "lucide-react";
import { api, errorMessage, post } from "@/lib/api";
import {
  CONFIDENCE_CLASS,
  FRESHNESS,
  fieldLabel,
  formatAgo,
  formatDate,
  formatValue,
  type ContactPoint,
  type EvidenceItem,
  type FactItem,
  type Overview,
  type PersonRow,
} from "@/lib/crm";

type Reload = () => Promise<void>;

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Runs an action with a busy flag and an inline error; reloads the page data on success. */
function useAction(onChange: Reload) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        await onChange();
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onChange],
  );
  return { busy, error, run };
}

// ── Contact points ──────────────────────────────────────────────────────────────────────────────

const CP_TYPES: { value: ContactPoint["type"]; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "BUSINESS_PHONE", label: "Business phone" },
  { value: "PHONE", label: "Phone" },
  { value: "MOBILE", label: "Mobile" },
  { value: "OTHER", label: "Other" },
];

const CP_STATUS: Record<ContactPoint["status"], { label: string; className: string; hint: string }> = {
  UNVERIFIED: { label: "Unverified", className: "", hint: "Not checked by a verification provider yet (Phase 8)" },
  VERIFIED: {
    label: "Verified",
    className: "border-brand/25 bg-brand-soft text-brand",
    hint: "Confirmed by a verification provider",
  },
  INVALID: {
    label: "Invalid",
    className: "border-danger/30 bg-danger-soft text-danger",
    hint: "A verification provider rejected it",
  },
  STALE: {
    label: "Stale",
    className: "border-amber/30 bg-amber-soft text-amber",
    hint: "Verification expired — re-check before use",
  },
};

export function ContactList({
  points,
  addPath,
  canManage,
  onChange,
}: {
  points: ContactPoint[];
  addPath: string;
  canManage: boolean;
  onChange: Reload;
}) {
  const { busy, error, run } = useAction(onChange);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ type: "EMAIL" as ContactPoint["type"], value: "", label: "" });

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await run("add", () =>
      post(addPath, {
        type: form.type,
        value: form.value,
        ...(form.label.trim() ? { label: form.label } : {}),
        isPrimary: points.every((p) => p.type !== form.type),
      }),
    );
    if (ok) {
      setForm({ ...form, value: "", label: "" });
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3">
      {points.length === 0 ? (
        <p className="text-sm text-muted">No contact details recorded.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {points.map((p) => {
            const Icon = p.type === "EMAIL" ? Mail : Phone;
            const s = CP_STATUS[p.status];
            return (
              <li key={p.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {p.value}
                    {p.label && <span className="text-xs text-faint"> · {p.label}</span>}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
                  {p.isPrimary && <span className="badge border-tone/25 bg-tone-soft text-tone">Primary</span>}
                  <span className={`badge ${s.className}`} title={s.hint}>
                    {s.label}
                  </span>
                  {canManage && (
                    <span className="flex gap-1">
                      {!p.isPrimary && (
                        <button
                          type="button"
                          title="Make primary"
                          aria-label="Make primary"
                          disabled={busy !== null}
                          onClick={() => void run(p.id, () => post(`/contact-points/${p.id}/primary`))}
                          className="btn btn-ghost size-7 px-0"
                        >
                          <Star className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remove (kept in history)"
                        aria-label="Remove"
                        disabled={busy !== null}
                        onClick={() =>
                          window.confirm(`Stop using ${p.value}? It stays in the history.`) &&
                          void run(p.id, () => api(`/contact-points/${p.id}`, { method: "DELETE" }))
                        }
                        className="btn btn-ghost size-7 px-0"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {canManage &&
        (adding ? (
          <form onSubmit={add} className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_8rem_auto]">
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ContactPoint["type"] })}
              aria-label="Type"
            >
              {CP_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              required
              autoFocus
              placeholder={form.type === "EMAIL" ? "name@company.com" : "(512) 555-0100"}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              aria-label="Value"
            />
            <input
              className="input"
              placeholder="Label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              aria-label="Label"
            />
            <div className="flex gap-1">
              <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                {busy === "add" && <Loader className="size-4 animate-spin" />} Add
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost h-8 px-3" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add contact
          </button>
        ))}
    </div>
  );
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────

export function PeopleTab({ data, onChange }: { data: Overview; onChange: Reload }) {
  const current = data.people.filter((p) => p.isCurrent);
  const past = data.people.filter((p) => !p.isCurrent);
  const canManage = data.allowedActions.managePeople;

  return (
    <div className="space-y-6">
      {canManage && <AddPerson companyId={data.company.id} onChange={onChange} />}
      {data.people.length === 0 ? (
        <div className="card flex items-center gap-3 px-5 py-5 text-sm text-muted">
          <Users className="size-4 shrink-0" /> Nobody recorded at this company yet.
          {canManage ? " Add the owner or a decision-maker above." : ""}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {current.map((p) => (
              <PersonCard key={p.employmentId} row={p} canManage={canManage} onChange={onChange} />
            ))}
          </div>
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted">Former employees</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {past.map((p) => (
                  <PersonCard key={p.employmentId} row={p} canManage={false} onChange={onChange} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <p className="text-xs text-faint">
        Professional context only. Decision power, relationship and the recommended contact come with research and the
        AI agents (Phases 8–9); an email is shown as verified only after a verification provider checks it.
      </p>
    </div>
  );
}

function PersonCard({ row, canManage, onChange }: { row: PersonRow; canManage: boolean; onChange: Reload }) {
  const { busy, error, run } = useAction(onChange);
  return (
    <div className={`card p-5 ${row.isCurrent ? "" : "opacity-75"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised">
          <User className="size-5 text-faint" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{row.person.fullName}</h3>
            {row.seniority && <span className="badge">{row.seniority}</span>}
          </div>
          <div className="text-sm text-muted">
            {[row.title, row.department].filter(Boolean).join(" · ") || "Role not recorded"}
            {!row.isCurrent && ` · left ${formatDate(row.endedAt)}`}
          </div>
          {row.person.linkedinUrl && (
            <a
              href={row.person.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Link2 className="size-3.5" /> LinkedIn <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {canManage && (
          <button
            type="button"
            title="No longer works here"
            aria-label="No longer works here"
            disabled={busy !== null}
            onClick={() =>
              window.confirm(`Mark ${row.person.fullName} as no longer working here? Their history is kept.`) &&
              void run("end", () => post(`/employments/${row.employmentId}/end`))
            }
            className="btn btn-ghost size-8 px-0"
          >
            <UserMinus className="size-4" />
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-4">
        <ContactList
          points={row.contactPoints}
          addPath={`/people/${row.person.id}/contact-points`}
          canManage={canManage}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

function AddPerson({ companyId, onChange }: { companyId: string; onChange: Reload }) {
  const { busy, error, run } = useAction(onChange);
  const [open, setOpen] = useState(false);
  const empty = { fullName: "", title: "", seniority: "", linkedinUrl: "" };
  const [form, setForm] = useState(empty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
    if (await run("add", () => post(`/companies/${companyId}/people`, body))) {
      setForm(empty);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add person
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">Add person</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["fullName", "Full name", "Maria Lopez"],
            ["title", "Title", "Owner"],
            ["seniority", "Seniority", "OWNER, MANAGER…"],
            ["linkedinUrl", "LinkedIn URL", "https://linkedin.com/in/…"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <label key={key}>
            <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
            <input
              className="input"
              required={key === "fullName"}
              autoFocus={key === "fullName"}
              type={key === "linkedinUrl" ? "url" : "text"}
              placeholder={placeholder}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy !== null}>
          {busy && <Loader className="size-4 animate-spin" />} Add person
        </button>
      </div>
    </form>
  );
}

// ── Intelligence: facts (never mixed with AI hypotheses) ────────────────────────────────────────

export function IntelligenceTab({ data, onChange }: { data: Overview; onChange: Reload }) {
  const fields = [...new Set(data.facts.map((f) => f.field))];
  const canRecord = data.allowedActions.recordEvidence;
  return (
    <div className="space-y-6">
      {canRecord && <RecordObservation companyId={data.company.id} onChange={onChange} />}
      <Section
        title="Facts"
        hint="Structured claims, each backed by evidence with a source and date. Conflicting sources are never silently overwritten."
      >
        {fields.length === 0 ? (
          <p className="text-sm text-muted">No facts recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {fields.map((field) => (
              <FactGroup
                key={field}
                field={field}
                facts={data.facts.filter((f) => f.field === field)}
                canResolve={canRecord}
                onChange={onChange}
              />
            ))}
          </ul>
        )}
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card flex items-start gap-3 p-4 text-sm">
          <Wrench className="mt-0.5 size-4 shrink-0 text-faint" />
          <div>
            <div className="font-medium">Signals</div>
            <p className="text-xs text-muted">Hiring, expansion and website changes arrive with Signals in Phase 16.</p>
          </div>
        </div>
        <div className="card flex items-start gap-3 p-4 text-sm">
          <Bot className="mt-0.5 size-4 shrink-0 text-faint" />
          <div>
            <div className="font-medium">AI hypotheses</div>
            <p className="text-xs text-muted">
              Opportunity hypotheses come with research (Phases 8–9) and are always labelled as inference, never as
              fact.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactGroup({
  field,
  facts,
  canResolve,
  onChange,
}: {
  field: string;
  facts: FactItem[];
  canResolve: boolean;
  onChange: Reload;
}) {
  const conflicted = facts.some((f) => f.status === "CONFLICTED");
  const { busy, error, run } = useAction(onChange);
  return (
    <li className={`rounded-xl border p-4 ${conflicted ? "border-amber/40 bg-amber-soft/30" : "border-line"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted">{fieldLabel(field)}</div>
        {conflicted && (
          <span className="badge border-amber/30 bg-amber-soft text-amber">
            <CircleAlert className="size-3" /> Needs verification
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-3">
        {facts.map((f) => (
          <FactRow
            key={f.id}
            fact={f}
            action={
              conflicted &&
              canResolve && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run(f.id, () => post(`/facts/${f.id}/resolve`))}
                  className="btn btn-secondary h-7 px-2.5 text-xs"
                >
                  {busy === f.id && <Loader className="size-3 animate-spin" />} This is correct
                </button>
              )
            }
          />
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

function FactRow({ fact, action }: { fact: FactItem; action?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const fresh = FRESHNESS[fact.freshness];
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-words">{formatValue(fact.value)}</span>
        <span className={`badge ${CONFIDENCE_CLASS[fact.confidence]}`}>{fact.confidence.toLowerCase()} confidence</span>
        <span className={`badge ${fresh.className}`} title={fresh.hint}>
          {fresh.label}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          aria-expanded={open}
        >
          {fact.evidence.length} {fact.evidence.length === 1 ? "source" : "sources"}
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <span className="ml-auto">{action}</span>
      </div>
      <div className="mt-0.5 text-xs text-faint">Last confirmed {formatDate(fact.lastConfirmedAt)}</div>
      {open && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-line pl-3">
          {fact.evidence.map((e) => (
            <EvidenceLine key={e.id} e={e} />
          ))}
        </ul>
      )}
    </li>
  );
}

function EvidenceLine({ e }: { e: EvidenceItem }) {
  const name = e.provider ?? e.sourceName ?? e.sourceType.toLowerCase();
  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium">{name}</span>
        <span className="text-faint">{e.sourceType.toLowerCase().replace("_", " ")}</span>
        <span className="text-muted">observed {formatDate(e.observedAt)}</span>
        {e.sourceUrl && (
          <a
            href={e.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 break-all text-accent hover:underline"
          >
            {e.sourceUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3 shrink-0" />
          </a>
        )}
      </div>
      {e.excerpt && <p className="mt-0.5 text-muted italic">“{e.excerpt}”</p>}
    </li>
  );
}

const SOURCE_TYPES = [
  ["WEBSITE", "Website"],
  ["PHONE_CALL", "Phone call"],
  ["EMAIL", "Email"],
  ["DIRECTORY", "Directory / listing"],
  ["SOCIAL", "Social profile"],
  ["DOCUMENT", "Document"],
  ["MANUAL", "Own knowledge"],
  ["OTHER", "Other"],
] as const;

function RecordObservation({ companyId, onChange }: { companyId: string; onChange: Reload }) {
  const { busy, error, run } = useAction(onChange);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const empty = {
    field: "",
    value: "",
    sourceType: "WEBSITE",
    sourceName: "",
    sourceUrl: "",
    observedAt: today,
    excerpt: "",
  };
  const [form, setForm] = useState(empty);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const field = form.field
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    let outcome = "";
    const ok = await run("save", async () => {
      const res = await post<{ outcome: string }>(`/companies/${companyId}/observations`, {
        field,
        value: form.value.trim(),
        source: {
          sourceType: form.sourceType,
          ...(form.sourceName.trim() ? { sourceName: form.sourceName.trim() } : {}),
          ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
          observedAt: new Date(`${form.observedAt}T12:00:00`).toISOString(),
          ...(form.excerpt.trim() ? { excerpt: form.excerpt.trim() } : {}),
        },
      });
      outcome = res.outcome;
    });
    if (ok) {
      setResult(
        outcome === "CONFLICTED"
          ? "Saved — it disagrees with what we already know, so both values are marked “needs verification”."
          : outcome === "CONFIRMED"
            ? "Saved — this confirms an existing fact with a new source."
            : "Saved as a new fact with its source.",
      );
      setForm(empty);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Record what you found
        </button>
        {result && <span className="text-sm text-muted">{result}</span>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Record what you found</h2>
        <p className="mt-0.5 text-xs text-muted">
          A fact is only as good as its source — say where you saw it and when.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">What (field)</span>
          <input
            className="input"
            required
            autoFocus
            list="fact-fields"
            placeholder="employee range"
            value={form.field}
            onChange={(e) => setForm({ ...form, field: e.target.value })}
          />
          <datalist id="fact-fields">
            {[
              "employee_range",
              "founded_year",
              "services",
              "service_area",
              "business_hours",
              "owner_name",
              "rating",
            ].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">Value</span>
          <input
            className="input"
            required
            placeholder="11–50"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">Source type</span>
          <select
            className="input"
            value={form.sourceType}
            onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
          >
            {SOURCE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">Observed on</span>
          <input
            className="input"
            type="date"
            required
            max={today}
            value={form.observedAt}
            onChange={(e) => setForm({ ...form, observedAt: e.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">Source name</span>
          <input
            className="input"
            placeholder="About page"
            value={form.sourceName}
            onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted">Source URL</span>
          <input
            className="input"
            type="url"
            placeholder="https://…"
            value={form.sourceUrl}
            onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-muted">Quote (optional)</span>
          <input
            className="input"
            placeholder="“Our team of 25 has served Austin since 2009”"
            value={form.excerpt}
            onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
          />
        </label>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy !== null}>
          {busy && <Loader className="size-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}

// ── Evidence ────────────────────────────────────────────────────────────────────────────────────

export function EvidenceTab({ data }: { data: Overview }) {
  return (
    <Section
      title="Evidence"
      hint="Everything we stored about this company, newest observation first. Merges keep each item's original source."
    >
      {data.evidence.length === 0 ? (
        <p className="text-sm text-muted">No evidence yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.evidence.map((e) => {
            const fresh = FRESHNESS[e.freshness];
            return (
              <li key={e.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:justify-between">
                <EvidenceLine e={e} />
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-faint">{e.factCount ?? 0} facts</span>
                  <span className={`badge ${fresh.className}`} title={fresh.hint}>
                    {fresh.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  at: string;
  action: string;
  entityType: string;
  reason: string | null;
  actor: { type: "HUMAN" | "AI_AGENT" | "SYSTEM" | "API_CLIENT" | "INTEGRATION"; name: string | null };
}

const ACTION_LABEL: Record<string, string> = {
  "company.created": "Company record created",
  "company.updated": "Company details edited",
  "company.archived": "Company archived",
  "company.restored": "Company restored",
  "company.merged": "Duplicate merged into this record",
  "company.auto_merged": "Duplicate merged automatically (safe, high-confidence match)",
  "company.merged_away": "Record merged into another company",
  "person.created": "Person added",
  "person.updated": "Person details edited",
  "employment.attached": "Person linked to the company",
  "employment.ended": "Person no longer works here",
  "contact_point.added": "Contact detail added",
  "contact_point.restored": "Contact detail restored",
  "contact_point.made_primary": "Primary contact changed",
  "contact_point.archived": "Contact detail removed",
  "evidence.recorded": "Evidence recorded",
  "fact.created": "New fact",
  "fact.confirmed": "Fact confirmed by another source",
  "fact.conflicted": "Conflicting fact — needs verification",
  "fact.superseded": "Fact corrected",
  "fact.conflict_resolved": "Conflict resolved",
  "duplicate.detected": "Possible duplicate detected",
  "duplicate.rejected": "Marked as not a duplicate",
};

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "HUMAN", label: "Human" },
  { key: "AI_AGENT", label: "AI actions" },
  { key: "SYSTEM", label: "System" },
] as const;

export function ActivityTab({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      try {
        const res = await api<{ items: ActivityItem[]; nextCursor: string | null }>(
          `/companies/${companyId}/activity?limit=50${after ? `&cursor=${after}` : ""}`,
        );
        setItems((prev) => (after && prev ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [companyId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (items ?? []).filter(
    (i) =>
      filter === "ALL" ||
      (filter === "SYSTEM" ? i.actor.type !== "HUMAN" && i.actor.type !== "AI_AGENT" : i.actor.type === filter),
  );

  return (
    <Section
      title="Activity"
      hint="Every change to this company and everything attached to it, from the audit trail."
      action={
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`badge cursor-pointer ${filter === f.key ? "border-tone/25 bg-tone-soft text-tone" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      }
    >
      {error && <p className="text-sm text-danger">{error}</p>}
      {items === null ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">
          {filter === "AI_AGENT" ? "No AI actions yet — agents arrive in Phase 9." : "Nothing here yet."}
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-line pl-5">
          {shown.map((i) => (
            <li key={i.id} className="relative">
              <span
                className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface ${i.actor.type === "HUMAN" ? "bg-tone" : "bg-faint"}`}
              />
              <div className="text-sm">{ACTION_LABEL[i.action] ?? i.action}</div>
              <div className="text-xs text-muted">
                {i.actor.type === "HUMAN"
                  ? (i.actor.name ?? "A teammate")
                  : i.actor.type === "AI_AGENT"
                    ? "AI agent"
                    : "System"}{" "}
                ·{" "}
                <time dateTime={i.at} title={new Date(i.at).toLocaleString()}>
                  {formatAgo(i.at)}
                </time>
              </div>
              {i.reason && <div className="mt-0.5 text-xs text-faint">“{i.reason}”</div>}
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <button type="button" className="btn btn-ghost mt-4 h-8" onClick={() => void load(cursor)}>
          Load older
        </button>
      )}
    </Section>
  );
}
