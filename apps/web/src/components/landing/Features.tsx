import { Activity, Bot, Brain, Crosshair, FileSearch, GitBranch, Inbox, Lightbulb } from "lucide-react";
import type { Tone } from "@/lib/screens";
import SectionHeader from "./SectionHeader";

/** Icon chips use the product's area colour code (lib/screens.ts TONES). */
const FEATURES: { icon: typeof Bot; title: string; tone: Tone; body: string }[] = [
  {
    icon: Crosshair,
    title: "Autonomous Lead Hunter",
    tone: "leads",
    body: "Understands your ICP, discovers companies across sources, removes duplicates, verifies emails and stores why each lead fits.",
  },
  {
    icon: FileSearch,
    title: "AI Research Agent",
    tone: "ai",
    body: "A mini research report per prospect. Evidence and AI inference are kept apart — a guess never becomes a fact in an email.",
  },
  {
    icon: GitBranch,
    title: "Dynamic Campaign Brain",
    tone: "email",
    body: "Branches on real behaviour — replies, signals, objections — instead of marching every lead through a fixed sequence.",
  },
  {
    icon: Inbox,
    title: "Unified AI Inbox",
    tone: "email",
    body: "Every reply classified by intent and sentiment, with a summary, qualification status and a suggested next step.",
  },
  {
    icon: Brain,
    title: "Long-term Sales Memory",
    tone: "ai",
    body: "Pain points, objections, budget signals, timelines, promises made and people involved — remembered at the company level.",
  },
  {
    icon: Activity,
    title: "Buying-signal monitoring",
    tone: "leads",
    body: "Hiring, expansion, leadership or tech changes trigger re-scoring, fresh research and a timely reason to re-engage.",
  },
  {
    icon: Lightbulb,
    title: "Next Best Action",
    tone: "sales",
    body: "Follow up, wait, research, offer a meeting, escalate or never contact — continuously recalculated for every account.",
  },
  {
    icon: Bot,
    title: "AI Sales Manager",
    tone: "ai",
    body: "Ask in plain language — “why did replies drop?” or “pause campaigns for dentists” — and get answers with suggested actions.",
  },
];

export default function Features() {
  return (
    <section id="product" aria-labelledby="product-title" className="scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8">
        <SectionHeader
          id="product-title"
          eyebrow="Product"
          title="Everything a sales team does, run by accountable AI"
          lede="Capabilities built around one company-first data model — so every agent shares the same context, memory and rules."
        />

        <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, tone, body }) => (
            <article key={title} data-tone={tone} className="group bg-surface p-6 transition-colors hover:bg-raised">
              <span className="grid size-10 place-items-center rounded-lg border border-tone/20 bg-tone-soft text-tone transition-colors group-hover:border-tone/40">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-[15px] font-semibold text-fg">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
