"use client";

import { useState, type FormEvent } from "react";
import { CircleAlert, Loader, Plus, Save, Send, Trash2, X } from "lucide-react";
import { KNOWLEDGE_FIELDS, KNOWLEDGE_TYPE_INFO, validateKnowledge, type FieldSpec, type KnowledgeType } from "@revenue-os/shared";
import { errorMessage, post, put } from "@/lib/api";

type Content = Record<string, unknown>;
const SERVICE_LINKED: KnowledgeType[] = ["PRICING", "FAQ", "INTEGRATION", "CASE_STUDY", "PROPOSAL_BLOCK"];
const SCHEDULABLE: KnowledgeType[] = ["PRICING", "POLICY", "SERVICE"];
const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** A blank item of a type: every field with its default. */
export function blankContent(type: KnowledgeType): Content {
  return validateKnowledge(type, {}).content;
}

/**
 * The structured editor (docs/13 §30-42: structured knowledge, not one huge Markdown). Fields come from the shared
 * spec, so the form and the server check the same rules. Saving makes a draft — the AI never uses it until approved.
 */
export function KnowledgeEditor({
  type,
  itemId,
  initial,
  title: initialTitle,
  services,
  serviceItemId: initialService,
  onSaved,
  onCancel,
}: {
  type: KnowledgeType;
  itemId?: string;
  initial?: Content;
  title?: string;
  services?: { id: string; title: string }[];
  serviceItemId?: string | null;
  onSaved: (r: { itemId: string; code: string }) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState<Content>(() => ({ ...blankContent(type), ...(initial ?? {}) }));
  const [title, setTitle] = useState(initialTitle ?? "");
  const [serviceItemId, setServiceItemId] = useState(initialService ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errors = validateKnowledge(type, content).errors;
  const info = KNOWLEDGE_TYPE_INFO[type];
  const needsTitle = type === "DOCUMENT" || type === "PROPOSAL_BLOCK";

  async function save(submit: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (submit && errors.length) return setError(errors.join(" · "));
    setBusy(submit ? "submit" : "save");
    setError(null);
    try {
      const body = {
        ...(needsTitle && title.trim() ? { title: title.trim() } : {}),
        content,
        ...(SERVICE_LINKED.includes(type) ? { serviceItemId: serviceItemId || null } : {}),
        ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
        ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}),
        submit,
      };
      const r = itemId ? await put<{ itemId: string; code: string }>(`/knowledge/items/${itemId}/draft`, body) : await post<{ itemId: string; code: string }>("/knowledge/items", { type, ...body });
      onSaved(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={(e) => void save(false, e)} className="card space-y-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{itemId ? `Edit ${info.label.toLowerCase()}` : `New ${info.label.toLowerCase()}`}</h2>
          <p className="text-xs text-muted">
            Saved as a draft{info.commercial ? " — pricing, policies and claims need the owner’s approval" : ""}. The AI uses it only after it is approved.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="btn btn-ghost h-8 px-2" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {needsTitle && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">Title</span>
          <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </label>
      )}
      {SERVICE_LINKED.includes(type) && services && services.length > 0 && (
        <label className="block space-y-1">
          <span className="text-xs font-medium">Service</span>
          <select className="input w-full" value={serviceItemId} onChange={(e) => setServiceItemId(e.target.value)}>
            <option value="">— General (all services)</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {KNOWLEDGE_FIELDS[type].map((f) => (
          <Field key={f.key} f={f} value={content[f.key]} onChange={(v) => setContent((c) => ({ ...c, [f.key]: v }))} />
        ))}
      </div>

      <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-2">
        {SCHEDULABLE.includes(type) && (
          <label className="block space-y-1">
            <span className="text-xs font-medium">Effective from (optional)</span>
            <input type="datetime-local" className="input w-full" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            <span className="block text-[11px] text-faint">A future date schedules it — the current version keeps answering until then.</span>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-medium">What changed (optional)</span>
          <input className="input w-full" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={300} placeholder="e.g. New price from November" />
        </label>
      </div>

      {(error || errors.length > 0) && (
        <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${error ? "border-danger/30 bg-danger-soft text-danger" : "border-amber/30 bg-amber-soft text-amber"}`}>
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{error ?? `Before submitting: ${errors.join(" · ")}`}</span>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
        <button type="submit" disabled={!!busy} className="btn btn-secondary">
          {busy === "save" ? <Loader className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft
        </button>
        <button type="button" disabled={!!busy || errors.length > 0} onClick={() => void save(true)} className="btn btn-primary">
          {busy === "submit" ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />} Submit for review
        </button>
      </div>
    </form>
  );
}

function Field({ f, value, onChange }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const wide = f.kind === "textarea" || f.kind === "rows";
  const label = (
    <span className="text-xs font-medium">
      {f.label}
      {f.required && <span className="text-danger"> *</span>}
    </span>
  );
  const help = f.help ? <span className="block text-[11px] text-faint">{f.help}</span> : null;
  if (f.kind === "boolean")
    return (
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>
          {f.label}
          {help}
        </span>
      </label>
    );
  if (f.kind === "rows") return <RowsField f={f} value={(value as Content[]) ?? []} onChange={onChange} />;
  return (
    <label className={`block space-y-1 ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {f.kind === "textarea" ? (
        <textarea className="input min-h-28 w-full py-2" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      ) : f.kind === "list" ? (
        <textarea className="input min-h-20 w-full py-2" placeholder="One per line" value={((value as string[]) ?? []).join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} />
      ) : f.kind === "select" ? (
        <select className="input w-full" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.options!.map((o) => (
            <option key={o} value={o}>
              {pretty(o)}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input w-full"
          type={f.kind === "money" || f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
          step={f.kind === "money" ? "0.01" : undefined}
          min={f.kind === "money" || f.kind === "number" ? 0 : undefined}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(f.kind === "money" || f.kind === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
        />
      )}
      {help}
    </label>
  );
}

function RowsField({ f, value, onChange }: { f: FieldSpec; value: Content[]; onChange: (v: unknown) => void }) {
  const cols = f.fields ?? [];
  const set = (i: number, key: string, v: unknown) => onChange(value.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <div className="space-y-2 md:col-span-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{f.label}</span>
        <button type="button" className="btn btn-ghost h-7 px-2 text-xs" onClick={() => onChange([...value, Object.fromEntries(cols.map((c) => [c.key, c.kind === "boolean" ? (c.default ?? false) : c.kind === "money" || c.kind === "number" ? null : ""]))])}>
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      {value.length === 0 && <p className="text-xs text-faint">None.</p>}
      {value.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2">
          {cols.map((c) =>
            c.kind === "boolean" ? (
              <label key={c.key} className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!row[c.key]} onChange={(e) => set(i, c.key, e.target.checked)} /> {c.label}
              </label>
            ) : (
              <label key={c.key} className="min-w-28 flex-1 space-y-1">
                <span className="text-[11px] text-muted">{c.label}</span>
                <input
                  className="input h-8 w-full text-sm"
                  type={c.kind === "money" || c.kind === "number" ? "number" : "text"}
                  value={row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key])}
                  onChange={(e) => set(i, c.key, c.kind === "money" || c.kind === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                />
              </label>
            ),
          )}
          <button type="button" className="btn btn-ghost h-8 px-2" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
