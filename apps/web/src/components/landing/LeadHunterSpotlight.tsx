import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ChartNoAxesColumn,
  ChevronDown,
  CircleCheck,
  Clock,
  Database,
  Globe,
  Layers,
  LayoutGrid,
  Lightbulb,
  Mail,
  MapPin,
  Monitor,
  PlayCircle,
  Search,
  ShieldCheck,
  Target,
  UserRound,
  Zap,
} from "lucide-react";
import LeadHunterVisual from "./LeadHunterVisual";

const MODES = [
  { icon: Zap, name: "Quick Scan", body: "Fast results from the strongest sources.", tag: "Minutes", tone: "text-[#ea580c] bg-[#fff1e8]" },
  { icon: Search, name: "Deep Search", body: "More sources, more queries, richer data.", tag: "Thorough", tone: "text-accent bg-accent-soft" },
  {
    icon: Database,
    name: "Full Market",
    body: "Keep searching until new opportunities stop appearing.",
    tag: "Max coverage",
    tone: "text-brand bg-brand-soft",
    recommended: true,
  },
];

const FACTS = [
  {
    icon: CircleCheck,
    tone: "text-brand bg-brand-soft",
    title: "Every fact has a source and last-checked date.",
    body: "Stale data and AI inference are flagged separately.",
  },
  {
    icon: ShieldCheck,
    tone: "text-accent bg-accent-soft",
    title: "Honest coverage confidence.",
    body: "See sources searched, queries exhausted and an estimated coverage level — never a fake “100%”.",
  },
  {
    icon: ChartNoAxesColumn,
    tone: "text-[#ea580c] bg-[#fff1e8]",
    title: "No website is a signal, not a dead end.",
    body: "Businesses without a site are kept and flagged as opportunities.",
  },
];

const SEARCHES = ["Businesses without websites", "Owner identified + verified email", "50+ reviews, weak website", "No online booking or chat"];

const PIPELINE = [
  { icon: MapPin, title: "Market discovery", body: "Finds businesses across multiple permitted sources.", count: "3,482 found", tone: "green" },
  { icon: Database, title: "Resolution & dedupe", body: "Merges records into one business.", count: "2,871 unique", tone: "blue" },
  { icon: Globe, title: "Website & social", body: "Finds and analyzes online presence.", count: "2,436 with website", tone: "green" },
  { icon: UserRound, title: "Owner & decision maker", body: "Identifies the right contact.", count: "1,936 contacts", tone: "blue" },
  { icon: Mail, title: "Contact verification", body: "Verifies emails and phones.", count: "1,421 verified", tone: "green" },
  { icon: Monitor, title: "Digital presence audit", body: "Site quality, reviews, booking, etc.", count: "1,008 analyzed", tone: "blue" },
  { icon: Lightbulb, title: "Opportunity detection", body: "Finds weak signals & gaps.", count: "714 opportunities", tone: "green" },
  { icon: Target, title: "ICP scoring", body: "Ranks by fit and buying signals.", count: "Top prospects", tone: "blue" },
] as const;

const PILLS = [
  { icon: Layers, title: "Multi-source", sub: "Maps, web & social", tone: "text-[#7c3aed] bg-[#f3edff]" },
  { icon: Clock, title: "Fresh data", sub: "Re-checked over time", tone: "text-brand bg-brand-soft" },
  { icon: ShieldCheck, title: "Policy-controlled", sub: "Safe & compliant", tone: "text-accent bg-accent-soft" },
  { icon: LayoutGrid, title: "Built for all industries", sub: "Not just one niche", tone: "text-[#ea580c] bg-[#fff1e8]" },
];

export default function LeadHunterSpotlight() {
  return (
    <section id="lead-hunter" aria-labelledby="lead-hunter-title" className="relative isolate scroll-mt-16 overflow-hidden border-t border-line py-24">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-60 [mask-image:radial-gradient(ellipse_60%_60%_at_20%_20%,black,transparent)]" />
      <div className="mx-auto grid max-w-page items-start gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8 2xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.3fr)_minmax(0,0.78fr)] 2xl:gap-8">
        {/* copy */}
        <div>
          <p className="eyebrow">Lead Hunter</p>
          <h2 id="lead-hunter-title" className="mt-3 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-[2.75rem] sm:leading-[1.05]">
            Find the <span className="text-brand">whole market</span> — not just the obvious leads.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
            Choose any location and industry. Rank High Lead discovers, verifies and organizes businesses across the market —
            including opportunities your competitors miss.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {MODES.map(({ icon: Icon, name, body, tag, tone, ...m }) => (
              <li
                key={name}
                className={`relative rounded-2xl border p-4 ${"recommended" in m ? "border-brand/40 bg-brand-soft/60" : "border-line bg-surface"}`}
              >
                {"recommended" in m && (
                  <span className="absolute -top-2.5 right-3 rounded-full border border-brand/30 bg-surface px-2 py-0.5 text-[10px] font-medium text-brand">Recommended</span>
                )}
                <span className={`grid size-9 place-items-center rounded-lg ${tone}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-[15px] font-semibold text-fg">{name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
                <span className="mt-3 inline-flex rounded-full bg-raised px-2.5 py-0.5 text-[11px] text-muted">{tag}</span>
              </li>
            ))}
          </ul>

          <ul className="mt-8 space-y-4">
            {FACTS.map(({ icon: Icon, tone, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{title}</p>
                  <p className="mt-0.5 text-sm text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">Search any market</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg">
                <MapPin className="size-3.5 fill-accent text-white" aria-hidden="true" /> Austin, TX
              </li>
              <li className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg">
                <Search className="size-3 text-faint" aria-hidden="true" /> Any industry <ChevronDown className="size-3 text-faint" aria-hidden="true" />
              </li>
              {SEARCHES.map((f) => (
                <li key={f} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted">
                  <Search className="size-3 text-faint" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link href="/lead-hunter" className="btn btn-primary btn-lg">
              Explore Lead Hunter
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className="inline-flex items-center gap-2 text-sm font-medium text-fg hover:text-brand">
              <PlayCircle className="size-6 text-muted" aria-hidden="true" /> See it in action
            </a>
          </div>
        </div>

        {/* dashboard illustration + pills */}
        <div className="2xl:pt-10">
          <LeadHunterVisual />
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {PILLS.map(({ icon: Icon, title, sub, tone }) => (
              <li key={title} className="card flex items-center gap-2.5 p-3">
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone}`}>
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-tight text-fg">{title}</p>
                  <p className="text-[11px] text-muted">{sub}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* enrichment pipeline */}
        <div className="card p-6 lg:col-span-2 2xl:col-span-1">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-fg">Enrichment pipeline</p>
            <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">Per business</span>
          </div>
          <ol className="mt-6 grid gap-x-8 lg:grid-cols-2 2xl:grid-cols-1">
            {PIPELINE.map(({ icon: Icon, title, body, count, tone }, i) => (
              <li key={title} className="relative flex gap-3 pb-5 last:pb-0 lg:[&:nth-last-child(2)]:pb-0 2xl:[&:nth-last-child(2)]:pb-5">
                {i < PIPELINE.length - 1 && (
                  <span aria-hidden="true" className="absolute top-11 bottom-1 left-[21px] border-l-2 border-dashed border-brand/30 lg:hidden 2xl:block" />
                )}
                <span className="relative grid size-11 shrink-0 place-items-center rounded-full border border-brand/20 bg-brand-soft text-brand">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm font-semibold text-fg">
                    <span className="mr-2 font-mono text-[11px] font-normal text-faint">{String(i + 1).padStart(2, "0")}</span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{body}</p>
                  <span
                    className={`mt-1.5 inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      tone === "green" ? "bg-brand-soft text-brand" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {count}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-canvas px-4 py-3 text-xs text-muted">
            <BarChart3 className="size-4 text-accent" aria-hidden="true" />
            Then: prioritization → outreach → conversation → meeting.
          </div>
        </div>
      </div>
    </section>
  );
}
