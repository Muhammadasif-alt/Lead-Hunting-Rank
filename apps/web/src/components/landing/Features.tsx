import {
  BarChart3,
  Brain,
  ChartLine,
  ChevronRight,
  Database,
  FileSearch,
  Inbox,
  Route,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { Tone } from "@/lib/screens";
import DashboardMock, { DASHBOARD_H, DASHBOARD_W } from "./DashboardMock";
import { ScaledCanvas } from "./ScaledCanvas";

type Feature = { icon: typeof Target; title: string; tone: Tone; body: string; tags: string[] };

/** Icon chips use the product's area colour code (lib/screens.ts TONES). */
const LEFT: Feature[] = [
  {
    icon: Target,
    title: "Smart Lead Finder",
    tone: "leads",
    body: "Finds and verifies businesses across any location or industry using multiple sources — websites, maps, social, news and more.",
    tags: ["Any industry", "Any location", "Verified data"],
  },
  {
    icon: FileSearch,
    title: "AI Research & Insights",
    tone: "email",
    body: "Creates a detailed research profile for each business. Keeps facts separate from inference so every message is based on real information.",
    tags: ["Website & social", "Recent news", "Buying signals"],
  },
  {
    icon: Route,
    title: "Multi-Channel Campaigns",
    tone: "ai",
    body: "Runs personalized outreach sequences across email, LinkedIn, SMS and calls with built-in safety checks.",
    tags: ["Email", "LinkedIn", "SMS", "Calling"],
  },
];

const RIGHT: Feature[] = [
  {
    icon: Inbox,
    title: "Unified Lead Inbox",
    tone: "sales",
    body: "All replies from every channel in one place. AI classifies intent, summarizes conversations and suggests the next best action.",
    tags: ["Auto-classify", "Summaries", "Next steps"],
  },
  {
    icon: Brain,
    title: "AI Sales Assistant",
    tone: "insight",
    body: "Ask questions in plain language — “why did replies drop?” or “pause campaigns for this industry” — and get clear answers with actions.",
    tags: ["Natural language", "Insights", "Take action"],
  },
  {
    icon: BarChart3,
    title: "Continuous Learning",
    tone: "email",
    body: "Every outcome feeds back into the system, making targeting, messaging and timing smarter over time.",
    tags: ["Track results", "Improve targeting", "Higher ROI"],
  },
];

const PILLARS = [
  { icon: Database, label: "One connected data model" },
  { icon: ShieldCheck, label: "Policy-controlled & safe" },
  { icon: ChartLine, label: "Built for real revenue outcomes" },
];

function FeatureCard({ f, n }: { f: Feature; n: number }) {
  const Icon = f.icon;
  return (
    <article data-tone={f.tone} className="card group flex h-full flex-col p-5 transition-colors hover:border-tone/30">
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-tone-soft text-tone">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[11px] text-faint">0{n}</span>
          <h3 className="text-[17px] font-semibold leading-tight text-fg">{f.title}</h3>
        </div>
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-muted transition-colors group-hover:border-tone/40 group-hover:text-tone">
          <ChevronRight className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{f.body}</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {f.tags.map((t) => (
          <li key={t} className="rounded-full bg-raised px-3 py-1 text-xs text-muted">
            {t}
          </li>
        ))}
      </ul>
    </article>
  );
}

export default function Features() {
  return (
    <section
      id="product"
      aria-labelledby="product-title"
      className="relative isolate scroll-mt-16 overflow-hidden border-t border-line py-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[520px] w-[900px] max-w-[140vw] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand/10 blur-3xl"
      />
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="eyebrow">Product</p>
          <h2
            id="product-title"
            className="mt-3 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-5xl sm:leading-[1.08]"
          >
            A complete AI sales platform to <span className="text-brand">find, engage</span> and{" "}
            <span className="text-accent">close</span> more leads
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">
            Powerful AI agents, one connected system. From prospecting to follow-up, everything works together with
            shared data, memory and rules — so your team never misses an opportunity.
          </p>
        </div>

        <div className="mt-14 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start">
          {/* dashboard first on small screens, centre column on wide ones */}
          <div className="xl:order-2 xl:self-center">
            <div className="rounded-[22px] border border-line bg-surface/70 p-3 shadow-[0_30px_70px_-30px_rgb(16_24_20/0.3)] backdrop-blur">
              <ScaledCanvas width={DASHBOARD_W} height={DASHBOARD_H} max={1.4}>
                <DashboardMock />
              </ScaledCanvas>
            </div>
            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {PILLARS.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center justify-center gap-3 text-sm text-fg sm:border-r sm:border-line sm:last:border-r-0"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border border-brand/25 bg-brand-soft text-brand">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="max-w-[9rem] leading-snug">{label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:order-1 xl:grid-cols-1">
            {LEFT.map((f, i) => (
              <FeatureCard key={f.title} f={f} n={i + 1} />
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:order-3 xl:grid-cols-1">
            {RIGHT.map((f, i) => (
              <FeatureCard key={f.title} f={f} n={i + 4} />
            ))}
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] text-faint">Illustration — example data</p>
      </div>
    </section>
  );
}
