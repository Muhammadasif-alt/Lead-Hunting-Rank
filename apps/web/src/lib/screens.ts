import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Building2,
  CalendarDays,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Plug,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

/**
 * The 18 screens (docs/01-screens.md) plus System Health, in sidebar order.
 * `phase` = roadmap phase that makes the screen real (docs/17 §1). No screen shows fake data before then.
 */
export interface Screen {
  href: string;
  title: string;
  icon: LucideIcon;
  group: ScreenGroup;
  phase: number | null;
  /** Functional area colour — see TONES. */
  tone: Tone;
  summary: string;
  capabilities: string[];
  spec?: string;
}

/**
 * Area colour code: each functional area has its own tone so the team instantly knows what kind of page they're on.
 * CSS: `data-tone="<tone>"` re-points the generic `--color-tone` / `--color-tone-soft` tokens (globals.css).
 */
export type Tone = "leads" | "email" | "sales" | "ai" | "insight" | "system";

export const TONES: Record<Tone, { label: string; short: string; description: string }> = {
  leads: { short: "Leads", label: "Lead data", description: "Finding and understanding companies" },
  email: { short: "Email", label: "Email & outreach", description: "Inbox, campaigns and conversations" },
  sales: { short: "Sales", label: "Sales", description: "Pipeline and meetings" },
  ai: { short: "AI", label: "AI", description: "Agents, memory, knowledge and autonomy" },
  insight: { short: "Insights", label: "Insights", description: "Attribution and performance" },
  system: { short: "System", label: "System", description: "Workspace, approvals and health" },
};

export const TONE_ORDER: Tone[] = ["leads", "email", "sales", "ai", "insight", "system"];

export type ScreenGroup = "Overview" | "Prospecting" | "Engagement" | "Intelligence" | "Operations";

export const SCREEN_GROUPS: ScreenGroup[] = ["Overview", "Prospecting", "Engagement", "Intelligence", "Operations"];

export const SCREENS: Screen[] = [
  {
    href: "/dashboard",
    title: "Command Center",
    icon: LayoutDashboard,
    group: "Overview",
    phase: 19,
    tone: "system",
    summary: "One screen that answers: what happened, what matters, what needs me, and what the AI is doing.",
    capabilities: ["Morning briefing from real activity", "Attention queue for decisions only you can make", "Live missions, pipeline, meetings and signals"],
    spec: "01-command-center.md",
  },
  {
    href: "/ai-manager",
    title: "AI Sales Manager",
    icon: Bot,
    group: "Overview",
    phase: 18,
    tone: "ai",
    summary: "Give the system a goal in plain language — it plans missions, checks feasibility and reports progress.",
    capabilities: ["Goal → plan → missions → agent tasks", "Feasibility check before anything runs", "Ask “why are meetings down?” and get funnel answers"],
    spec: "02-ai-sales-manager.md",
  },
  {
    href: "/lead-hunter",
    title: "Lead Hunter",
    icon: Radar,
    group: "Prospecting",
    phase: 7,
    tone: "leads",
    summary: "Map an entire local market from multiple sources, de-duplicated, with honest coverage confidence.",
    capabilities: ["Quick, Deep and Market Exhaust modes", "Every fact stored with source and last-checked date", "Natural-language filters like “landscapers without a website”"],
    spec: "03-lead-hunter.md",
  },
  {
    href: "/companies",
    title: "Companies",
    icon: Building2,
    group: "Prospecting",
    phase: 6,
    tone: "leads",
    summary: "The canonical record of every business: people, contact points, evidence and activity.",
    capabilities: ["Company 360° and Prospect 360° profiles", "Facts vs AI inference kept separate", "Duplicate candidates reviewed — never blindly merged"],
    spec: "04-company-360-prospect-360.md",
  },
  {
    href: "/signals",
    title: "Signals",
    icon: TrendingUp,
    group: "Prospecting",
    phase: 15,
    tone: "leads",
    summary: "Buying signals — hiring, funding, website changes, leadership moves — turned into “why now” hypotheses.",
    capabilities: ["One signal, many pieces of evidence", "Re-score and re-research on change", "A signal alone never authorises outreach"],
    spec: "09-signals.md",
  },
  {
    href: "/inbox",
    title: "AI Inbox",
    icon: Inbox,
    group: "Engagement",
    phase: 11,
    tone: "email",
    summary: "Every reply understood: intent classified, follow-ups stopped, memory updated, next action decided.",
    capabilities: ["Priority by intent and value, not unread time", "AUTO / ASSIST / HUMAN per conversation", "One-click human takeover"],
    spec: "05-conversations-ai-inbox.md",
  },
  {
    href: "/campaigns",
    title: "Campaigns",
    icon: Send,
    group: "Engagement",
    phase: 10,
    tone: "email",
    summary: "Behaviour-driven outreach that revalidates every prospect before each touch.",
    capabilities: ["Validation before launch: audience, suppression, mailbox health", "Follow-ups reconsider — never fire blindly", "Stops instantly on reply, unsubscribe or kill switch"],
    spec: "06-campaigns.md",
  },
  {
    href: "/opportunities",
    title: "Opportunities",
    icon: Target,
    group: "Engagement",
    phase: 12,
    tone: "sales",
    summary: "An intelligent pipeline built from commercial evidence, not pipeline spam.",
    capabilities: ["Qualification: need, timeline, budget, authority", "Explicit stage changes with full history", "Won / lost with evidence and reason"],
    spec: "07-opportunities.md",
  },
  {
    href: "/meetings",
    title: "Meetings",
    icon: CalendarDays,
    group: "Engagement",
    phase: 13,
    tone: "sales",
    summary: "From meeting intent to a provider-confirmed calendar event, with a brief ready beforehand.",
    capabilities: ["Real availability, timezone-aware slots", "Never marked booked until the calendar confirms", "Pre-meeting brief: need, objections, commitments"],
    spec: "08-calendar-meetings.md",
  },
  {
    href: "/analytics",
    title: "Analytics",
    icon: BarChart3,
    group: "Intelligence",
    phase: 16,
    tone: "insight",
    summary: "Where revenue actually came from — source to signal to campaign to meeting to won deal.",
    capabilities: ["Full lifecycle attribution", "Market, source and campaign performance", "AI vs human contribution and provider cost"],
    spec: "10-analytics.md",
  },
  {
    href: "/experiments",
    title: "Experiments",
    icon: FlaskConical,
    group: "Intelligence",
    phase: 17,
    tone: "ai",
    summary: "Controlled tests of ICP, offer, subject, persona and timing — optimised for meetings, not opens.",
    capabilities: ["Hypothesis → experiment → outcome → learning", "Confidence-based results", "Adoption is proposed, never silent"],
    spec: "11-experiments.md",
  },
  {
    href: "/memory",
    title: "AI Memory",
    icon: Brain,
    group: "Intelligence",
    phase: 14,
    tone: "ai",
    summary: "Structured long-term memory of every relationship: pains, objections, promises, people and timing.",
    capabilities: ["Memories with provenance and freshness", "Contradictions detected, history preserved", "Open commitments tracked"],
    spec: "12-ai-memory.md",
  },
  {
    href: "/knowledge",
    title: "Knowledge Base",
    icon: BookOpen,
    group: "Intelligence",
    phase: 14,
    tone: "ai",
    summary: "The approved business brain — services, pricing, FAQs, case studies — that grounds every AI claim.",
    capabilities: ["Upload → review → approve → publish", "Only approved knowledge grounds autonomous replies", "Knowledge gaps surfaced automatically"],
    spec: "13-knowledge-base.md",
  },
  {
    href: "/tasks",
    title: "Tasks & Approvals",
    icon: ListChecks,
    group: "Operations",
    phase: 20,
    tone: "system",
    summary: "Only the decisions that need a human: pricing approvals, sensitive replies, overdue promises.",
    capabilities: ["Approval shows exact action, risk, evidence and expiry", "Prioritised by impact, not noise", "Commitments and follow-ups in one place"],
    spec: "14-tasks-human-attention.md",
  },
  {
    href: "/integrations",
    title: "Integrations",
    icon: Plug,
    group: "Operations",
    phase: 5,
    tone: "system",
    summary: "Gmail, Google Calendar, LLM and lead-data providers behind clean adapters with live health.",
    capabilities: ["Connection, capability and health per provider", "Usage and cost tracking", "Credentials never reach the browser"],
    spec: "15-integrations.md",
  },
  {
    href: "/team",
    title: "Team & Roles",
    icon: Users,
    group: "Operations",
    phase: 21,
    tone: "system",
    summary: "Owner, Admin, Sales, Researcher and Viewer roles with authority limits and a full audit trail.",
    capabilities: ["Server-side permissions — UI hiding is not security", "Authority limits (e.g. max discount)", "Every change audited"],
    spec: "16-team-roles-permissions.md",
  },
  {
    href: "/ai-control",
    title: "AI Control Center",
    icon: ShieldCheck,
    group: "Operations",
    phase: 21,
    tone: "ai",
    summary: "Autonomy levels L0–L4, policies, budgets, agent permissions and the global kill switch.",
    capabilities: ["AI proposes — policy decides: ACT / ASK / WAIT / BLOCK", "Per-campaign autonomy levels", "Emergency stop for all outbound"],
    spec: "17-ai-control-center.md",
  },
  {
    href: "/settings",
    title: "Settings",
    icon: Settings,
    group: "Operations",
    phase: 21,
    tone: "system",
    summary: "Workspace, compliance rules, sending limits, working hours and system administration.",
    capabilities: ["Suppression and do-not-contact rules", "Queues, backups, imports and exports", "Feature flags and developer settings"],
    spec: "18-settings.md",
  },
  {
    href: "/diagnostics",
    title: "System Health",
    icon: Activity,
    group: "Operations",
    phase: null,
    tone: "system",
    summary: "Live status of web, API, database, Redis, workers, the event pipeline and failed jobs.",
    capabilities: [],
  },
];

export function findScreen(href: string): Screen {
  const screen = SCREENS.find((s) => s.href === href);
  if (!screen) throw new Error(`Unknown screen: ${href}`);
  return screen;
}

/** Screen for a pathname (exact or nested), or undefined for routes outside the registry. */
export function screenForPath(pathname: string): Screen | undefined {
  return SCREENS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
}

export { CURRENT_PHASE } from "./roadmap";
