/** Build phases from docs/17-tech-spec-13-implementation-roadmap.md §1. Keep `done` in sync with docs/PROGRESS.md. */
export const ROADMAP: { phase: number; name: string; done: boolean }[] = [
  { phase: 0, name: "Engineering setup", done: true },
  { phase: 1, name: "Platform foundation", done: true },
  { phase: 2, name: "Database foundation", done: true },
  { phase: 3, name: "Authentication + RBAC", done: true },
  { phase: 4, name: "Events, outbox + queues", done: true },
  { phase: 5, name: "Provider gateway", done: true },
  { phase: 6, name: "CRM core — Company 360", done: true },
  { phase: 7, name: "Lead Hunter", done: false },
  { phase: 8, name: "Research + intelligence", done: false },
  { phase: 9, name: "AI runtime + agents", done: false },
  { phase: 10, name: "Campaigns + outreach", done: false },
  { phase: 11, name: "Conversations + AI Inbox", done: false },
  { phase: 12, name: "Opportunities + qualification", done: false },
  { phase: 13, name: "Calendar + meetings", done: false },
  { phase: 14, name: "Memory + knowledge", done: false },
  { phase: 15, name: "Signals + intent", done: false },
  { phase: 16, name: "Analytics + attribution", done: false },
  { phase: 17, name: "Experiments + learning", done: false },
  { phase: 18, name: "AI Sales Manager", done: false },
  { phase: 19, name: "Command Center", done: false },
  { phase: 20, name: "Human attention + tasks", done: false },
  { phase: 21, name: "Integrations + admin", done: false },
  { phase: 22, name: "Security + reliability hardening", done: false },
  { phase: 23, name: "Production deployment", done: false },
  { phase: 24, name: "Controlled autonomy rollout", done: false },
];

/** Highest completed phase. */
export const CURRENT_PHASE = Math.max(-1, ...ROADMAP.filter((p) => p.done).map((p) => p.phase));
