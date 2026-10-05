"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Clock,
  Loader,
  Lock,
  MapPin,
  Plug,
  Radar,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import {
  COUNTRIES,
  DISCOVERY_MODES,
  INDUSTRIES,
  US_STATES,
  formatLocation,
  industryLabel,
  interpretMarketRequest,
  relatedCategories,
  type DiscoveryMode,
  type WebsiteFilter,
} from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { MediaSplit } from "@/components/ui/MediaSplit";
import { ApiError, api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import {
  COVERAGE_CLASS,
  COVERAGE_LABEL,
  MISSION_STATUS_LABEL,
  MODE_LABEL,
  isActive,
  missionStatusClass,
  sourceHealth,
  type MarketRow,
  type MissionListResponse,
  type MissionSummary,
  type PreviewResponse,
} from "@/lib/discovery";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

const EXAMPLES = [
  "Every landscaper in Austin, TX",
  "Roofers in Dallas, Texas — deep hunt",
  "Plumbers in Phoenix without a website",
  "Quick look at dentists in Denver",
];

const MODE_ORDER: DiscoveryMode[] = ["QUICK", "DEEP", "MARKET_EXHAUST"];

const PIPELINE: { title: string; detail: string }[] = [
  { title: "Plan queries", detail: "Main category first, then related categories and variations — never repeated." },
  { title: "Search sources", detail: "Every connected lead source, page by page, inside the mode's call budget." },
  { title: "Resolve duplicates", detail: "Each listing is matched to one company. Unsure matches go to review." },
  { title: "Measure coverage", detail: "Counts the new unique businesses each round added." },
  {
    title: "Continue or stop",
    detail: "Stops when new results dry up, every query was tried, or the budget is spent.",
  },
];

const STATE_OPTIONS = Object.entries(US_STATES)
  .map(([name, code]) => ({ code, name: name.replace(/\b\w/g, (c) => c.toUpperCase()) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const WEBSITE_FILTERS: { value: WebsiteFilter; label: string }[] = [
  { value: "ANY", label: "Every business" },
  { value: "WITHOUT", label: "Without a website" },
  { value: "WITH", label: "With a website" },
];

interface Fields {
  country: string;
  region: string;
  city: string;
  industry: string;
}

const EMPTY_FIELDS: Fields = { country: "US", region: "", city: "", industry: "" };

/**
 * Lead Hunter (screen #3, Phase 7): describe a market, confirm how it was understood, pick a depth and start a hunt.
 * Nothing runs until the person confirms; sources and limits shown are the real ones from the API preview.
 */
export function LeadHunter() {
  const me = useMe();
  const router = useRouter();
  const canRead = me.permissions.includes("market.read");
  const canRun = me.permissions.includes("market.run");

  const [request, setRequest] = useState("");
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [mode, setMode] = useState<DiscoveryMode>("DEEP");
  const [categories, setCategories] = useState<string[] | null>(null);
  const [websiteFilter, setWebsiteFilter] = useState<WebsiteFilter>("ANY");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ message: string; runningId?: string | null } | null>(null);
  const previewSeq = useRef(0);

  const interpretation = useMemo(() => (request.trim() ? interpretMarketRequest(request) : null), [request]);

  /** Fill the structured form from what the typed request says (only what was understood; the rest stays). */
  const applyInterpretation = useCallback((text: string) => {
    if (!text.trim()) return;
    const i = interpretMarketRequest(text);
    setFields((prev) => {
      const next = { ...prev };
      if (i.industry) next.industry = i.industry;
      if (i.location.country || i.location.region || i.location.city) {
        next.country = i.location.country ?? prev.country;
        next.region = i.location.region ?? "";
        next.city = i.location.city ?? "";
      }
      return next;
    });
    if (i.industry) setCategories(null);
    if (i.mode) setMode(i.mode);
    setWebsiteFilter(i.websiteFilter);
  }, []);

  // Typing fills the form after a short pause.
  useEffect(() => {
    const t = setTimeout(() => applyInterpretation(request), 350);
    return () => clearTimeout(t);
  }, [request, applyInterpretation]);

  const ready = !!fields.industry.trim() && !!fields.country;

  const runPreview = useCallback(async () => {
    const seq = ++previewSeq.current;
    setPreviewing(true);
    try {
      const res = await post<PreviewResponse>("/discovery-missions/preview", {
        request: request.trim() || undefined,
        industry: fields.industry.trim(),
        country: fields.country,
        region: fields.region.trim() || undefined,
        city: fields.city.trim() || undefined,
        mode,
        categories: categories ?? undefined,
      });
      if (seq !== previewSeq.current) return;
      setPreview(res);
      setPreviewError(null);
    } catch (err) {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setPreviewError(errorMessage(err));
    } finally {
      if (seq === previewSeq.current) setPreviewing(false);
    }
  }, [request, fields, mode, categories]);

  // Any edit re-checks the plan against the API (debounced).
  useEffect(() => {
    if (!ready || !canRead) {
      previewSeq.current++;
      setPreview(null);
      setPreviewError(null);
      setPreviewing(false);
      return;
    }
    const t = setTimeout(() => void runPreview(), 450);
    return () => clearTimeout(t);
  }, [ready, canRead, runPreview]);

  const available = preview?.categories.available ?? relatedCategories(fields.industry);
  const selected = mode === "QUICK" ? [] : (categories ?? preview?.categories.selected ?? available);
  const runningId = preview?.market.runningMissionId ?? null;

  function setField<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "country" && (prev.country === "US") !== (value === "US")) next.region = "";
      return next;
    });
    if (key === "industry") setCategories(null);
    setStartError(null);
  }

  function toggleCategory(c: string) {
    setCategories(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  }

  function onInterpret(e: FormEvent) {
    e.preventDefault();
    applyInterpretation(request);
  }

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await post<{ mission: MissionSummary }>("/discovery-missions", {
        request: request.trim() || undefined,
        industry: fields.industry.trim(),
        country: fields.country,
        region: fields.region.trim() || undefined,
        city: fields.city.trim() || undefined,
        mode,
        categories: mode === "QUICK" ? [] : selected,
      });
      const qs = websiteFilter === "ANY" ? "" : `?website=${websiteFilter.toLowerCase()}`;
      router.push(`/lead-hunter/${res.mission.id}${qs}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === "MISSION_ALREADY_RUNNING") {
        // The refreshed preview carries runningMissionId, which shows the "Open running hunt" link.
        setStartError({ message: "A hunt for this market is already running or paused.", runningId });
        void runPreview();
      } else {
        setStartError({ message: errorMessage(err) });
      }
      setStarting(false);
    }
  }

  const blockReason = !canRun
    ? "Your role can't start hunts — ask an Owner, Admin or Researcher."
    : !ready
      ? "Add a business type and country first."
      : previewing && !preview
        ? "Checking the plan…"
        : previewError
          ? "Fix the problem above first."
          : !preview
            ? "Checking the plan…"
            : preview.sources.length === 0
              ? "Connect a lead source first."
              : runningId
                ? "This market already has a hunt in progress."
                : null;

  return (
    <div className="space-y-8">
      <PageHeader screen={findScreen("/lead-hunter")} />

      {!canRead ? (
        <div className="card px-5 py-4 text-sm text-muted">
          You don&apos;t have permission to view markets and hunts.
        </div>
      ) : (
        <>
          <div className="card space-y-6 p-4 sm:p-6">
            {/* 1. Describe the market */}
            <form onSubmit={onInterpret}>
              <label htmlFor="lh-query" className="text-sm font-medium">
                Describe the market
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Sparkles className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-brand" />
                  <input
                    id="lh-query"
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    placeholder="e.g. Find every landscaper in Austin, TX — with or without a website"
                    className="input h-11 pl-9"
                    autoComplete="off"
                  />
                </div>
                <button type="submit" className="btn btn-secondary h-11" disabled={!request.trim()}>
                  <Wand2 className="size-4" /> Interpret
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setRequest(ex);
                      applyInterpretation(ex);
                    }}
                    className="badge transition-colors hover:border-brand/40 hover:text-fg"
                  >
                    {ex}
                  </button>
                ))}
              </div>

              {interpretation && (
                <div className="mt-4 rounded-xl border border-line bg-raised/60 p-3">
                  <div className="text-xs font-medium text-muted">Understood as</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {interpretation.understood.map((u) => (
                      <span key={u} className="badge border-brand/25 bg-brand-soft text-brand">
                        {u}
                      </span>
                    ))}
                    {interpretation.missing.includes("industry") && (
                      <span className="badge border-amber/30 bg-amber-soft text-amber">
                        Business type not understood — pick it below
                      </span>
                    )}
                    {interpretation.missing.includes("location") && (
                      <span className="badge border-amber/30 bg-amber-soft text-amber">
                        Location not understood — set it below
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-faint">
                    Check the fields below — you can correct anything before starting.
                  </p>
                </div>
              )}
            </form>

            {/* 2. Structured market */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-xs font-medium text-muted">Country</span>
                <select
                  className="input mt-1.5"
                  value={fields.country}
                  onChange={(e) => setField("country", e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">State / region</span>
                {fields.country === "US" ? (
                  <select
                    className="input mt-1.5"
                    value={fields.region}
                    onChange={(e) => setField("region", e.target.value)}
                  >
                    <option value="">Whole country</option>
                    {STATE_OPTIONS.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input mt-1.5"
                    value={fields.region}
                    placeholder="Optional"
                    onChange={(e) => setField("region", e.target.value)}
                  />
                )}
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">City / area</span>
                <input
                  className="input mt-1.5"
                  value={fields.city}
                  placeholder="Optional, e.g. Austin"
                  onChange={(e) => setField("city", e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted">Business type</span>
                <input
                  className="input mt-1.5"
                  list="lh-industries"
                  value={fields.industry}
                  placeholder="e.g. landscaping"
                  onChange={(e) => setField("industry", e.target.value)}
                />
                <datalist id="lh-industries">
                  {INDUSTRIES.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.label}
                    </option>
                  ))}
                </datalist>
              </label>
            </div>

            {/* 3. Depth */}
            <fieldset>
              <legend className="text-sm font-medium">Search depth</legend>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                {MODE_ORDER.map((m) => {
                  const p = DISCOVERY_MODES[m];
                  return (
                    <label
                      key={m}
                      className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                        mode === m ? "border-brand/50 bg-brand-soft" : "border-line hover:border-line-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={m}
                        checked={mode === m}
                        onChange={() => setMode(m)}
                        className="sr-only"
                      />
                      <div className="text-sm font-medium">{p.label}</div>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{p.description}</p>
                      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
                        <li>
                          <span className="font-medium text-fg tabular-nums">{p.maxRounds}</span>{" "}
                          {p.maxRounds === 1 ? "round" : "rounds max"}
                        </li>
                        <li>
                          <span className="font-medium text-fg tabular-nums">{p.maxQueries}</span>{" "}
                          {p.maxQueries === 1 ? "query" : "queries max"}
                        </li>
                        <li>
                          <span className="font-medium text-fg tabular-nums">{p.maxProviderCalls}</span> provider calls
                        </li>
                        <li>
                          <span className="font-medium text-fg tabular-nums">{p.pageLimit}</span> pages / query
                        </li>
                        <li className="col-span-2">
                          {p.sources === "PRIMARY" ? "Preferred source only" : "Every connected source"}
                        </li>
                      </ul>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* 4. Breadth */}
            <fieldset>
              <legend className="text-sm font-medium">Related categories</legend>
              {mode === "QUICK" ? (
                <p className="mt-1 text-xs text-muted">
                  Quick Hunt searches the main category only. Choose Deep Hunt or Market Exhaust to add related
                  categories.
                </p>
              ) : !fields.industry.trim() ? (
                <p className="mt-1 text-xs text-muted">Pick a business type to see related categories.</p>
              ) : available.length === 0 ? (
                <p className="mt-1 text-xs text-muted">
                  No related categories known for “{industryLabel(fields.industry)}” yet — the hunt searches the main
                  category and its variations.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted">
                    Businesses often list themselves under a neighbouring category. Selected ones are searched too — you
                    control how broad the hunt is.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {available.map((c) => {
                      const on = selected.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleCategory(c)}
                          className={`badge transition-colors ${
                            on ? "border-brand/40 bg-brand-soft text-brand" : "hover:border-line-strong hover:text-fg"
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="badge text-faint hover:text-fg"
                      onClick={() => setCategories(available)}
                    >
                      All
                    </button>
                    <button type="button" className="badge text-faint hover:text-fg" onClick={() => setCategories([])}>
                      None
                    </button>
                  </div>
                </>
              )}
            </fieldset>

            {/* 5. Results view + enrichment note */}
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-muted">Show in results</span>
                <select
                  className="input mt-1.5"
                  value={websiteFilter}
                  onChange={(e) => setWebsiteFilter(e.target.value as WebsiteFilter)}
                >
                  {WEBSITE_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-faint">
                  A results filter only — the hunt still finds every business in the market.
                </span>
              </label>
              <div className="rounded-xl border border-dashed border-line-strong p-3 text-xs leading-relaxed text-muted">
                <div className="flex items-center gap-1.5 font-medium text-fg">
                  <Lock className="size-3.5" /> Enrichment arrives in Phase 8
                </div>
                A hunt finds and de-duplicates businesses from listings (name, phone, address, website if listed).
                Website, social and owner discovery come in Phase 8.
              </div>
            </div>

            {/* 6. Sources + plan check */}
            <SourcesPanel ready={ready} previewing={previewing} preview={preview} mode={mode} error={previewError} />

            {runningId && (
              <div className="flex flex-col gap-2 rounded-xl border border-amber/30 bg-amber-soft/50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-start gap-2">
                  <Clock className="mt-0.5 size-4 shrink-0 text-amber" />
                  {preview?.market.name} already has a hunt in progress — one hunt per market at a time.
                </span>
                <Link href={`/lead-hunter/${runningId}`} className="btn btn-secondary h-8 self-start sm:self-auto">
                  Open running hunt
                </Link>
              </div>
            )}

            {startError && (
              <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /> {startError.message}
                </span>
                {startError.runningId && (
                  <Link
                    href={`/lead-hunter/${startError.runningId}`}
                    className="btn btn-secondary h-8 self-start sm:self-auto"
                  >
                    Open running hunt
                  </Link>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-muted">
                {preview ? (
                  <>
                    <span className="font-medium text-fg">{preview.market.name}</span> ·{" "}
                    {MODE_LABEL[preview.mode] ?? preview.mode} · {preview.strategies}{" "}
                    {preview.strategies === 1 ? "query plan" : "query plans"} per source
                    {preview.market.existingMarketId && " · saved market, new run"}
                  </>
                ) : (
                  blockReason
                )}
                {preview && blockReason && <div className="mt-1 text-amber">{blockReason}</div>}
              </div>
              <button
                type="button"
                onClick={() => void start()}
                disabled={!!blockReason || starting}
                title={blockReason ?? undefined}
                className="btn btn-primary shrink-0"
              >
                {starting ? <Loader className="size-4 animate-spin" /> : <MapPin className="size-4" />} Start hunt
              </button>
            </div>
          </div>

          <RecentHunts />
          <SavedMarkets
            onUse={(m) => {
              setFields({ country: m.country, region: m.region ?? "", city: m.city ?? "", industry: m.industry });
              setCategories(null);
              setStartError(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />

          <MediaSplit
            src="/images/hunt-landscaper.jpg"
            focus="50% 15%"
            alt="A landscaper trimming a tall hedge — the kind of local business a hunt finds"
          >
            <section className="card p-4 sm:p-6">
              <h3 className="text-sm font-semibold">How a hunt runs</h3>
              <ol className="mt-4 space-y-2.5">
                {PIPELINE.map((step, i) => (
                  <li key={step.title} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-raised font-mono text-[10px] text-muted">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{step.title}</span>
                      <span className="block text-xs text-muted">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-sm font-semibold">Honest coverage</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Results report sources searched, unique businesses, duplicate listings and how many new businesses
                  each round added — with a coverage confidence, never a claim of “100% of the market”. Every listing is
                  kept as evidence with its source and date.
                </p>
              </div>
            </section>
          </MediaSplit>
        </>
      )}
    </div>
  );
}

function SourcesPanel({
  ready,
  previewing,
  preview,
  mode,
  error,
}: {
  ready: boolean;
  previewing: boolean;
  preview: PreviewResponse | null;
  mode: DiscoveryMode;
  error: string | null;
}) {
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Plug className="size-4 text-muted" /> Lead sources
        </h3>
        {previewing && <Loader className="size-4 animate-spin text-faint" />}
      </div>

      {error ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : !ready ? (
        <p className="mt-2 text-xs text-muted">Sources are checked once a business type and country are set.</p>
      ) : !preview ? (
        <p className="mt-2 text-xs text-muted">Checking connected sources…</p>
      ) : preview.sources.length === 0 ? (
        <div className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted">
            No lead source is connected, so a hunt has nowhere to search.{" "}
            <span className="text-faint">Test sources are available.</span>
          </p>
          <Link href="/integrations" className="btn btn-secondary h-8 self-start sm:self-auto">
            <Plug className="size-4" /> Connect a lead source
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {preview.sources.map((s, i) => {
              const h = sourceHealth(s.health);
              const unused = mode === "QUICK" && i > 0;
              return (
                <li
                  key={s.integrationId}
                  className={`flex flex-wrap items-center justify-between gap-2 text-sm ${unused ? "opacity-50" : ""}`}
                >
                  <span className="min-w-0 truncate">
                    {s.name}
                    {unused && <span className="ml-2 text-xs text-faint">not used by Quick Hunt</span>}
                  </span>
                  <span className={`badge ${h.className}`}>{h.label}</span>
                </li>
              );
            })}
          </ul>
          {preview.sources.length === 1 && mode !== "QUICK" && (
            <p className="mt-2 text-xs text-faint">
              With a single source, coverage confidence can&apos;t reach High — a second source is needed to
              cross-check.
            </p>
          )}
        </>
      )}

      {preview && preview.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {preview.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 text-xs text-amber">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentHunts() {
  const [data, setData] = useState<MissionListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    try {
      const res = await api<MissionListResponse>(`/discovery-missions?${params}`);
      setData((prev) => (cursor && prev ? { ...res, items: [...prev.items, ...res.items] } : res));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep running hunts' numbers current (first page only, so "Load more" isn't reset).
  const anyActive = data?.items.some((m) => isActive(m.status)) ?? false;
  const firstPageOnly = (data?.items.length ?? 0) <= 10;
  useEffect(() => {
    if (!anyActive || !firstPageOnly) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [anyActive, firstPageOnly, load]);

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Recent hunts</h2>
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      {data === null ? (
        !error && (
          <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading…
          </div>
        )
      ) : data.items.length === 0 ? (
        <div className="card flex items-center gap-3 px-5 py-4 text-sm text-muted">
          <Radar className="size-5 shrink-0 text-tone" /> No hunts yet. Describe a market above to run the first one.
        </div>
      ) : (
        <>
          <ul className="card divide-y divide-line overflow-hidden">
            {data.items.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/lead-hunter/${m.id}`}
                  className="flex flex-col gap-2 px-4 py-3.5 hover:bg-hover/60 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.market.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {MODE_LABEL[m.mode] ?? m.mode} · {formatAgo(m.startedAt ?? m.createdAt)}
                      {m.createdBy && ` · ${m.createdBy.name}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
                    <span className="text-muted">
                      <span className="font-medium text-fg tabular-nums">{m.uniqueCompanies}</span> unique
                    </span>
                    {m.coverageConfidence && (
                      <span className={`badge ${COVERAGE_CLASS[m.coverageConfidence]}`}>
                        {COVERAGE_LABEL[m.coverageConfidence]} coverage
                      </span>
                    )}
                    <span className={`badge ${missionStatusClass(m.status)}`}>
                      {isActive(m.status) && m.status !== "WAITING" && <Loader className="size-3 animate-spin" />}
                      {MISSION_STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {data.nextCursor && (
            <div className="flex justify-center">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(data.nextCursor ?? undefined);
                  setLoadingMore(false);
                }}
              >
                {loadingMore && <Loader className="size-4 animate-spin" />} Load more
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SavedMarkets({ onUse }: { onUse: (m: MarketRow) => void }) {
  const [items, setItems] = useState<MarketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: MarketRow[] }>("/markets")
      .then((d) => setItems(d.items))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) {
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Saved markets</h2>
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      </section>
    );
  }
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Saved markets</h2>
        <p className="text-xs text-muted">
          A market is a place + business type. Hunting it again searches for businesses added since.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => (
          <li key={m.id} className="card flex flex-col gap-3 p-4">
            <div className="min-w-0">
              <div className="truncate font-medium">{m.name}</div>
              <div className="mt-0.5 text-xs text-muted">
                {industryLabel(m.industry)} ·{" "}
                {formatLocation({ country: m.country, region: m.region ?? undefined, city: m.city ?? undefined })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>
                <span className="font-medium text-fg tabular-nums">{m.uniqueCompanies}</span> businesses (latest hunt)
              </span>
              <span>
                · {m.missions} {m.missions === 1 ? "hunt" : "hunts"}
              </span>
              {m.lastDiscoveryAt && <span>· {formatAgo(m.lastDiscoveryAt)}</span>}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {m.latestMission && (
                <Link href={`/lead-hunter/${m.latestMission.id}`} className="btn btn-secondary h-8">
                  Latest hunt
                  <span className={`badge h-5 ${missionStatusClass(m.latestMission.status)}`}>
                    {MISSION_STATUS_LABEL[m.latestMission.status] ?? m.latestMission.status}
                  </span>
                </Link>
              )}
              <button type="button" className="btn btn-ghost h-8" onClick={() => onUse(m)}>
                <RotateCcw className="size-4" /> Hunt again
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
