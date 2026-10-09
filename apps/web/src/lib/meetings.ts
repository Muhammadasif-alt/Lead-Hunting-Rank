/** Shapes of the Meetings API (`/api/v1/meetings`, Phase 14) and display helpers. */
import type { MeetingOutcomeKey, MeetingQualificationRuleKey, MeetingStatusKey, StageSemantic } from "@revenue-os/shared";

export interface MeetingCard {
  id: string;
  title: string;
  typeName: string;
  status: MeetingStatusKey;
  startAt: string | null;
  endAt: string | null;
  pendingStartAt: string | null;
  timezone: string;
  ownerTimezone: string;
  locationType: string;
  meetingUrl: string | null;
  company: { id: string; name: string } | null;
  contact: string | null;
  owner: { id: string; name: string | null } | null;
  opportunity: { id: string; name: string; stage: StageSemantic; stageName: string; status: string } | null;
  conversationId: string | null;
  highlights: string[];
  priority: "HIGH" | "NORMAL";
  needsOutcome: boolean;
  brief: { gaps: number; generatedAt: string } | null;
  slots: number;
  statusReason: string | null;
  nextAction: string;
  createdAt: string;
}

export interface MeetingList {
  summary: { next24h: number; next7d: number; arranging: number; needsOutcome: number; noShowFollowUps: number; prepRequired: number };
  next: MeetingCard | null;
  meetings: MeetingCard[];
  arranging: MeetingCard[];
  needsAction: MeetingCard[];
}

export interface BriefContent {
  who: { name: string; title: string | null; role: string | null }[];
  team: { name: string; role: string | null }[];
  company: { name: string; where: string; industry: string | null; website: string | null };
  whyEngaged: { reason: string; quote: string | null } | null;
  need: string | null;
  known: { label: string; value: string; quote: string | null; verified: boolean }[];
  unknown: { label: string; ask: string }[];
  questionsAsked: string[];
  objections: { type: string; text: string }[];
  stakeholders: { name: string; role: string; status: string }[];
  signals: { label: string; confidence: string }[];
  previousMeetings: { title: string; at: string | null; status: string; outcome: string | null; nextStep: string | null }[];
  suggestedQuestions: { question: string; reason: string }[];
  dontAskAgain: string[];
  objective: string;
  commitments: string[];
}

export interface MeetingDetail {
  meeting: {
    id: string;
    title: string;
    status: MeetingStatusKey;
    statusReason: string | null;
    startAt: string | null;
    endAt: string | null;
    pendingStartAt: string | null;
    pendingEndAt: string | null;
    timezone: string;
    timezoneSource: string;
    timezoneConfidence: "HIGH" | "MEDIUM" | "LOW";
    ownerTimezone: string;
    routingReason: string | null;
    requestText: string | null;
    preferenceLabel: string | null;
    slots: { start: string; end: string }[];
    slotsCheckedAt: string | null;
    offeredAt: string | null;
    locationType: string;
    meetingUrl: string | null;
    bookedVia: string | null;
    bookedAt: string | null;
    providerEventId: string | null;
    lastSyncedAt: string | null;
    cancelSource: string | null;
    cancelReason: string | null;
    cancelledAt: string | null;
    completedAt: string | null;
    createdByType: string;
    createdAt: string;
    version: number;
    nextAction: string;
  };
  type: { id: string; key: string; name: string; durationMinutes: number; aiBookingAllowed: boolean; requiredQualification: MeetingQualificationRuleKey };
  owner: { id: string; name: string | null } | null;
  company: { id: string; name: string; industry: string | null; city: string | null; region: string | null; website: string | null };
  conversation: { id: string; subject: string; email: string; contactName: string | null; category: string; stage: string; mode: string } | null;
  opportunity: { id: string; name: string; status: string; stage: StageSemantic; stageName: string; amountMinor: number | null; currency: string } | null;
  attendees: { id: string; side: "INTERNAL" | "EXTERNAL"; name: string; email: string | null; role: string | null; personId: string | null; userId: string | null; expected: boolean; attended: boolean | null }[];
  brief: { version: number; versions: number; content: BriefContent; gaps: string[]; method: string; generatedAt: string } | null;
  outcome: { outcome: MeetingOutcomeKey; summary: string | null; notes: string | null; nextStep: string | null; recommendedStage: StageSemantic | null; stageApplied: boolean; recordedBy: string | null; recordedAt: string } | null;
  action: { id: string; actionType: string; status: string; statusReason: string | null; approvalRequestId: string | null; resumeAt: string | null } | null;
  changes: { id: string; kind: string; fromStartAt: string | null; toStartAt: string | null; toEndAt: string | null; source: string; actorType: string; actorName: string | null; reason: string | null; at: string }[];
  journey: { id: string; title: string; status: MeetingStatusKey; startAt: string | null; outcome: MeetingOutcomeKey | null; current: boolean }[];
  noShows: number;
  noShowRisk: string | null;
  types: { id: string; name: string; durationMinutes: number; blocked: string | null; aiBookingAllowed: boolean }[];
  owners: { id: string; name: string }[];
  allowedActions: string[];
}

export interface Profile {
  userId: string;
  timezone: string;
  workingDays: number[];
  meetingStartMinute: number;
  meetingEndMinute: number;
  lunchStartMinute: number | null;
  lunchEndMinute: number | null;
  bufferMinutes: number;
  maxMeetingsPerDay: number;
  minNoticeMinutes: number;
  calendarIntegrationId: string | null;
  calendarId: string;
  acceptsMeetings: boolean;
  unavailableUntil: string | null;
  version: number;
}

export interface MeetingTypeRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  requiredQualification: MeetingQualificationRuleKey;
  aiBookingAllowed: boolean;
  briefEnabled: boolean;
  locationType: string;
  active: boolean;
  version: number;
}

export interface MeetingSetup {
  workspaceTimezone: string;
  types: MeetingTypeRow[];
  me: Profile | null;
  team: { user: { id: string; name: string; email: string }; profile: Profile | null }[];
  calendars: { id: string; name: string; provider: string; status: string; test: boolean }[];
  suggestedTimezone: string;
}

export const STATUS_STYLE: Record<MeetingStatusKey, string> = {
  PROPOSED: "border-tone-ai/25 bg-tone-ai-soft text-tone-ai",
  PENDING_CONFIRMATION: "border-amber/30 bg-amber-soft text-amber",
  BOOKED: "border-brand/25 bg-brand-soft text-brand",
  RESCHEDULING: "border-amber/30 bg-amber-soft text-amber",
  COMPLETED: "",
  NO_SHOW: "border-danger/25 bg-danger-soft text-danger",
  CANCELLED: "",
};

const fmt = (opts: Intl.DateTimeFormatOptions, tz?: string) => new Intl.DateTimeFormat(undefined, { ...opts, ...(tz ? { timeZone: tz } : {}) });

/** "1:30 PM" (in `tz`, else the viewer's zone). */
export function timeOf(iso: string, tz?: string): string {
  return fmt({ hour: "numeric", minute: "2-digit" }, tz).format(new Date(iso));
}

/** "Thu, Oct 15 · 1:30 PM" (in `tz`, else the viewer's zone). */
export function whenOf(iso: string, tz?: string): string {
  const d = new Date(iso);
  return `${fmt({ weekday: "short", month: "short", day: "numeric" }, tz).format(d)} · ${timeOf(iso, tz)}`;
}

/** "CDT" for a zone at a moment. */
export function zoneOf(tz: string, iso?: string): string {
  try {
    return fmt({ timeZoneName: "short" }, tz).formatToParts(iso ? new Date(iso) : new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "in 42 minutes" / "in 3 hours" / "tomorrow" / "2 days ago". */
export function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 3_600_000) return rtf.format(Math.round(ms / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(ms / 3_600_000), "hour");
  return rtf.format(Math.round(ms / 86_400_000), "day");
}

/** Local day key + heading for grouping an agenda. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
export function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const label = fmt({ weekday: "long", month: "long", day: "numeric" }).format(d);
  return same(d, today) ? `Today — ${label}` : same(d, tomorrow) ? `Tomorrow — ${label}` : label;
}

/** Minutes after midnight ↔ "HH:MM" for time inputs. */
export const minuteToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const timeToMinute = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** A datetime-local value ("2026-10-15T13:30") in the viewer's zone → ISO. */
export const localInputToIso = (v: string) => new Date(v).toISOString();
export const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const CHANGE_SOURCE: Record<string, string> = { PROSPECT: "the prospect", TEAM: "a person", SYSTEM: "the system", PROVIDER: "the calendar", AI: "the AI", MANUAL: "a person" };
