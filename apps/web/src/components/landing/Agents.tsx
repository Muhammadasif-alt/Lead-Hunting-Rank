import {
  CalendarCheck,
  ChartLine,
  FileSearch,
  Handshake,
  ListChecks,
  MessagesSquare,
  PenLine,
  Telescope,
} from "lucide-react";
import type { Tone } from "@/lib/screens";
import { MediaSplit } from "@/components/ui/MediaSplit";
import SectionHeader from "./SectionHeader";

/** Icon chips use the product's area colour code (lib/screens.ts TONES). */
const AGENTS: { icon: typeof Telescope; name: string; tone: Tone; body: string }[] = [
  {
    icon: FileSearch,
    name: "Research",
    tone: "leads",
    body: "Builds an evidence-backed brief on each company.",
  },
  {
    icon: Telescope,
    name: "Prospecting",
    tone: "leads",
    body: "Finds the right person and a real reason to contact.",
  },
  {
    icon: PenLine,
    name: "Copy",
    tone: "email",
    body: "Writes personalization grounded only in verified facts.",
  },
  {
    icon: MessagesSquare,
    name: "Conversation",
    tone: "email",
    body: "Handles replies in context of the full account history.",
  },
  {
    icon: ListChecks,
    name: "Qualification",
    tone: "sales",
    body: "Tracks need, timeline, budget signals and fit.",
  },
  {
    icon: Handshake,
    name: "Objection",
    tone: "sales",
    body: "Responds to concerns — or escalates sensitive ones.",
  },
  {
    icon: CalendarCheck,
    name: "Scheduling",
    tone: "sales",
    body: "Books the meeting and hands over a context brief.",
  },
  {
    icon: ChartLine,
    name: "Sales Intelligence",
    tone: "insight",
    body: "Finds what works and what to stop doing.",
  },
];

export default function Agents() {
  return (
    <section aria-labelledby="agents-title" className="border-t border-line bg-surface/40 py-24">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8">
        <SectionHeader
          id="agents-title"
          eyebrow="Specialist agents"
          title="A team of focused agents, sharing one memory"
          lede="Each agent does one job well and works from the same company-level context — so nobody contradicts what was already said."
        />

        <div className="mt-16">
          <MediaSplit
            src="/images/agents-team.jpg"
            alt="A sales team reviewing account research together on a laptop"
            reverse
            minHeight={420}
          >
            <ul className="grid gap-4 sm:grid-cols-2">
              {AGENTS.map(({ icon: Icon, name, tone, body }) => (
                <li
                  key={name}
                  data-tone={tone}
                  className="card flex items-start gap-4 p-5 transition-colors hover:border-line-strong"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-tone-soft text-tone">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{name} agent</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </MediaSplit>
        </div>
      </div>
    </section>
  );
}
