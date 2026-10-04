"use client";

import { useState } from "react";
import { Lock, MapPin, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { findScreen } from "@/lib/screens";

const MODES = [
  { id: "quick", name: "Quick Hunt", desc: "Fast scan of the main sources for a first look at the market." },
  { id: "deep", name: "Deep Hunt", desc: "More sources and queries, plus website and owner discovery." },
  { id: "exhaust", name: "Market Exhaust", desc: "Keeps searching new strategies until new unique results dry up." },
] as const;

const EXAMPLES = [
  "Austin landscapers without a website",
  "Website but no online booking or chat",
  "Owner identified + verified email",
  "50+ reviews, weak website",
];

const ENRICH = ["Website & social", "Decision makers", "Contact data", "Services & reviews", "Tech stack", "AI opportunity"];

const PIPELINE = [
  "Market discovery",
  "Dedup & resolution",
  "Website + social",
  "Owner discovery",
  "Contact verification",
  "Digital audit",
  "Opportunity detection",
  "ICP scoring",
];

/**
 * Lead Hunter mission builder. Fully laid out so the workflow is clear, but launching is disabled until the
 * discovery engine exists (Phase 7) — no fake results are shown.
 */
export function LeadHunter() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("exhaust");
  const [query, setQuery] = useState("");

  return (
    <div className="space-y-8">
      <PageHeader screen={findScreen("/lead-hunter")} />

      <div className="space-y-6">
        <form className="card space-y-6 p-6" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="lh-query" className="text-sm font-medium">
              Describe the market
            </label>
            <div className="relative mt-2">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand" />
              <input
                id="lh-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Find every landscaper in Austin, TX — with or without a website"
                className="input h-11 pl-9"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="badge transition-colors hover:border-brand/40 hover:text-fg"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { id: "country", label: "Country", options: ["United States", "United Kingdom", "Canada"] },
              { id: "state", label: "State / region", options: ["Texas", "California", "New York"] },
              { id: "city", label: "City / area", options: ["Austin", "Dallas", "Houston"] },
              { id: "industry", label: "Business type", options: ["Landscaping", "Roofing", "HVAC", "Plumbing", "Dentists"] },
            ].map((f) => (
              <div key={f.id}>
                <label htmlFor={`lh-${f.id}`} className="text-xs font-medium text-muted">
                  {f.label}
                </label>
                <select id={`lh-${f.id}`} className="input mt-1.5" defaultValue="" required>
                  <option value="" disabled>
                    Select…
                  </option>
                  {f.options.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Search depth</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {MODES.map((m) => (
                <label
                  key={m.id}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    mode === m.id ? "border-brand/50 bg-brand-soft" : "border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={m.id}
                    checked={mode === m.id}
                    onChange={() => setMode(m.id)}
                    className="sr-only"
                  />
                  <div className="text-sm font-medium">{m.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{m.desc}</p>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Enrich with</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ENRICH.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" defaultChecked className="size-4 accent-[var(--color-brand)]" />
                  {e}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-xs text-muted">
              <Lock className="size-3.5" /> Launching hunts unlocks in Phase 7, once the discovery engine is built.
            </p>
            <button type="submit" disabled className="btn btn-primary">
              <MapPin className="size-4" /> Start hunt
            </button>
          </div>
        </form>

        {/* Below the builder: how a hunt runs (steps flow left → right on wide screens) and what "coverage" means. */}
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="card p-6">
            <h3 className="text-sm font-semibold">How a hunt runs</h3>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PIPELINE.map((step, i) => (
                <li key={step} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-mono text-[10px] text-muted">
                    {i + 1}
                  </span>
                  <span className="text-sm text-muted">{step}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="card p-6">
            <h3 className="text-sm font-semibold">Honest coverage</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Results report sources searched, unique businesses, duplicate rate and marginal yield — with a coverage
              confidence, never a claim of “100% of the market”. Every fact keeps its source and last-checked date.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
