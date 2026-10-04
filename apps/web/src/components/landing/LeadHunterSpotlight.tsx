import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Gauge,
  Globe,
  GitMerge,
  Lightbulb,
  MapPin,
  Search,
  Target,
  UserSearch,
} from "lucide-react";
import SectionHeader from "./SectionHeader";

const MODES = [
  { name: "Quick", body: "Fast first pass over the strongest sources." },
  { name: "Deep", body: "More sources, more queries, richer enrichment." },
  { name: "Exhaust Market", body: "Keep searching until new queries stop finding new businesses." },
];

const FILTERS = [
  "Austin landscapers without website",
  "Owner identified + verified email",
  "50+ reviews, weak website",
  "Website but no booking or chat",
  "Facebook active, no website",
];

const PIPELINE = [
  {
    icon: MapPin,
    title: "Market discovery",
    body: "Territory + industry across multiple permitted sources",
  },
  {
    icon: GitMerge,
    title: "Resolution & dedupe",
    body: "Records merged into one canonical business",
  },
  {
    icon: Globe,
    title: "Website & social",
    body: "Website, Facebook, Instagram, LinkedIn found or ruled out",
  },
  {
    icon: UserSearch,
    title: "Owner & decision maker",
    body: "Who runs the business and their role",
  },
  {
    icon: BadgeCheck,
    title: "Contact verification",
    body: "Business emails and phones checked before use",
  },
  {
    icon: Gauge,
    title: "Digital presence audit",
    body: "Site quality, mobile, booking, chat, reviews",
  },
  {
    icon: Lightbulb,
    title: "Opportunity detection",
    body: "No website, weak SEO, slow review response…",
  },
  { icon: Target, title: "ICP scoring", body: "Ranked by fit and timing, with the reason stored" },
];

export default function LeadHunterSpotlight() {
  return (
    <section id="lead-hunter" aria-labelledby="lead-hunter-title" className="scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto grid max-w-page items-start gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="lg:sticky lg:top-24">
          <SectionHeader
            id="lead-hunter-title"
            align="left"
            eyebrow="Lead Hunter"
            title={
              <>
                Geo market exhaustion, <span className="text-gradient">not a top-20 search</span>
              </>
            }
            lede="Tell it “find every landscaper in Austin — with or without a website.” Lead Hunter merges and deduplicates multiple public, permitted sources into a city-level map of the whole market."
          />

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {MODES.map((m, i) => (
              <li
                key={m.name}
                className={`rounded-xl border p-4 ${
                  i === 2 ? "border-brand/40 bg-brand-soft" : "border-line bg-surface"
                }`}
              >
                <p className={`text-sm font-semibold ${i === 2 ? "text-brand" : "text-fg"}`}>{m.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{m.body}</p>
              </li>
            ))}
          </ul>

          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
              <span>
                <span className="text-fg">Every fact has a source and last-checked date.</span> Stale data and AI
                inference are flagged separately from evidence.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <span>
                <span className="text-fg">Honest coverage confidence.</span> You see sources searched, queries exhausted
                and an estimated coverage level — never a fake “100%”.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
              <span>
                <span className="text-fg">No website is a signal, not a dead end.</span> Businesses without a site are
                kept and flagged as opportunities.
              </span>
            </li>
          </ul>

          <div className="mt-8">
            <p className="text-xs font-medium tracking-wide text-faint uppercase">Filter in plain language</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <li
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted"
                >
                  <Search className="size-3 text-faint" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <Link href="/lead-hunter" className="btn btn-secondary mt-10">
            Open Lead Hunter
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="card p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">Enrichment pipeline</p>
            <span className="badge">per business</span>
          </div>
          <ol className="mt-6">
            {PIPELINE.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative flex gap-4 pb-6 last:pb-0">
                {i < PIPELINE.length - 1 ? (
                  <span aria-hidden="true" className="absolute top-10 bottom-0 left-[19px] w-px bg-line" />
                ) : null}
                <span className="relative grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-raised text-brand">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <div className="pt-0.5">
                  <p className="text-sm font-medium text-fg">
                    <span className="mr-2 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-lg border border-line bg-canvas px-4 py-3 text-xs text-muted">
            Then: prioritization → outreach → conversation → meeting.
          </div>
        </div>
      </div>
    </section>
  );
}
