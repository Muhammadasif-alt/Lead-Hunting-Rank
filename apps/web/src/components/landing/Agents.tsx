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
import SectionHeader from "./SectionHeader";

const AGENTS = [
  { icon: FileSearch, name: "Research", body: "Builds an evidence-backed brief on each company." },
  { icon: Telescope, name: "Prospecting", body: "Finds the right person and a real reason to contact." },
  { icon: PenLine, name: "Copy", body: "Writes personalization grounded only in verified facts." },
  { icon: MessagesSquare, name: "Conversation", body: "Handles replies in context of the full account history." },
  { icon: ListChecks, name: "Qualification", body: "Tracks need, timeline, budget signals and fit." },
  { icon: Handshake, name: "Objection", body: "Responds to concerns — or escalates sensitive ones." },
  { icon: CalendarCheck, name: "Scheduling", body: "Books the meeting and hands over a context brief." },
  { icon: ChartLine, name: "Sales Intelligence", body: "Finds what works and what to stop doing." },
];

export default function Agents() {
  return (
    <section aria-labelledby="agents-title" className="border-t border-line bg-surface/40 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          id="agents-title"
          eyebrow="Specialist agents"
          title="A team of focused agents, sharing one memory"
          lede="Each agent does one job well and works from the same company-level context — so nobody contradicts what was already said."
        />

        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map(({ icon: Icon, name, body }) => (
            <li
              key={name}
              className="card flex items-start gap-4 p-5 transition-colors hover:border-line-strong"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-fg">{name} agent</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
