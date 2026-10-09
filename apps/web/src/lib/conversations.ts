/** Shapes of the Conversations API (`/api/v1/conversations`, Phase 12) and display helpers for the AI Inbox. */
import type { ConversationMode, ConversationStage, InboxCategory, Intent } from "@revenue-os/shared";

export type WaitingOn = "US" | "PROSPECT" | "NOBODY";
export type ReplyStatus =
  | "DRAFT"
  | "REJECTED"
  | "PENDING_APPROVAL"
  | "WAITING"
  | "QUEUED"
  | "SENT"
  | "BLOCKED"
  | "CANCELLED"
  | "FAILED"
  | "DISCARDED"
  | "SUPERSEDED";

export interface ConversationRow {
  id: string;
  company: { id: string; name: string; industry: string | null; city: string | null } | null;
  contactName: string | null;
  email: string;
  subject: string;
  category: InboxCategory;
  stage: ConversationStage;
  mode: ConversationMode;
  waitingOn: WaitingOn;
  priority: number;
  priorityReasons: string[];
  needsHuman: boolean;
  escalationReason: string | null;
  primaryIntent: Intent | null;
  sentiment: string | null;
  summary: string | null;
  snippet: { text: string; direction: string; author: string } | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  unread: boolean;
  snoozedUntil: string | null;
  assignedTo: { id: string; name: string } | null;
  draftReady: boolean;
  pendingApproval: boolean;
}

export interface InboxList {
  counts: Record<InboxCategory, number>;
  waitingOnUs: number;
  items: ConversationRow[];
}

export interface Classification {
  primaryIntent: Intent;
  secondaryIntents: Intent[];
  sentiment: string;
  questions: string[];
  objections: { type: string; text: string }[];
  riskFlags: string[];
  needsHuman: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  method: string;
}

export interface ThreadMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  author: "PROSPECT" | "AI" | "HUMAN" | "SYSTEM";
  authorName: string | null;
  fromEmail: string | null;
  subject: string;
  text: string;
  kind: string | null;
  fromCampaign: boolean;
  occurredAt: string;
  classification: Classification | null;
}

export interface Reply {
  id: string;
  author: "AI" | "HUMAN";
  authorName: string | null;
  subject: string;
  body: string;
  status: ReplyStatus;
  statusReason: string | null;
  answered: { question: string; answer: string; source: string }[];
  unanswered: string[];
  validation: { validator: string; ok: boolean; detail: string }[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  inReplyToMessageId: string | null;
  stale: boolean;
  approvalId: string | null;
  resumeAt: string | null;
  feedback: { rating: "UP" | "DOWN"; reason: string | null } | null;
  sentAt: string | null;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: {
    id: string;
    subject: string;
    email: string;
    contactName: string | null;
    stage: ConversationStage;
    mode: ConversationMode;
    category: InboxCategory;
    waitingOn: WaitingOn;
    priority: number;
    priorityReasons: string[];
    needsHuman: boolean;
    escalationReason: string | null;
    primaryIntent: Intent | null;
    sentiment: string | null;
    summary: string | null;
    snoozedUntil: string | null;
    resolvedAt: string | null;
    takenOver: { by: string | null; at: string } | null;
    assignedToId: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    createdAt: string;
    version: number;
    nextAction: string;
  };
  company: {
    id: string;
    name: string;
    industry: string | null;
    city: string | null;
    region: string | null;
    website: string | null;
    phone: string | null;
    priority: { level: string; reasons: string[] } | null;
  } | null;
  person: { id: string; name: string; title: string | null } | null;
  campaign: { id: string; name: string; offer: string; status: string } | null;
  enrollment: { id: string; status: string; statusReason: string | null; repliedAt: string | null } | null;
  mailbox: { id: string; name: string; provider: string; status: string; address: string | null; testMailbox: boolean } | null;
  policy: { autonomyLevel: string; outboundState: string; aiRepliesNeedApproval: boolean };
  messages: ThreadMessage[];
  replies: Reply[];
  context: { field: string; value: string; quote: string; messageId: string; at: string; id: string | null }[];
  factHistory: { id: string; field: string; value: string; quote: string; status: string; confidence: string; messageId: string; createdAt: string }[];
  timeline: { id: string; type: string; payload: Record<string, unknown>; actorType: string; actorName: string | null; at: string }[];
  members: { id: string; name: string }[];
}

/** Category look: the inbox is an email area (blue tone) but each bucket reads at a glance. */
export const CATEGORY_STYLE: Record<InboxCategory, string> = {
  HIGH_INTENT: "border-brand/25 bg-brand-soft text-brand",
  NEEDS_HUMAN: "border-amber/30 bg-amber-soft text-amber",
  AI_HANDLING: "border-tone-ai/25 bg-tone-ai-soft text-tone-ai",
  MEETING: "border-accent/25 bg-accent-soft text-accent",
  NURTURE: "border-line bg-raised text-muted",
  CLOSED: "border-line bg-raised text-faint",
};

export const CATEGORY_ORDER: InboxCategory[] = ["HIGH_INTENT", "NEEDS_HUMAN", "MEETING", "AI_HANDLING", "NURTURE", "CLOSED"];

const WARM: Intent[] = ["POSITIVE", "QUESTION", "PRICING", "MEETING_REQUEST"];
const COLD: Intent[] = ["NEGATIVE", "UNSUBSCRIBE", "WRONG_PERSON"];
export function intentStyle(intent: string | null): string {
  if (!intent) return "";
  if (WARM.includes(intent as Intent)) return "border-brand/25 bg-brand-soft text-brand";
  if (COLD.includes(intent as Intent)) return "border-danger/25 bg-danger-soft text-danger";
  if (intent === "OBJECTION" || intent === "UNKNOWN") return "border-amber/30 bg-amber-soft text-amber";
  return "";
}

export const REPLY_STATUS: Record<ReplyStatus, { label: string; className: string }> = {
  DRAFT: { label: "AI draft", className: "border-tone-ai/25 bg-tone-ai-soft text-tone-ai" },
  REJECTED: { label: "Draft failed checks", className: "border-danger/25 bg-danger-soft text-danger" },
  PENDING_APPROVAL: { label: "Needs approval", className: "border-amber/30 bg-amber-soft text-amber" },
  WAITING: { label: "Waiting to send", className: "border-amber/30 bg-amber-soft text-amber" },
  QUEUED: { label: "Sending", className: "border-accent/25 bg-accent-soft text-accent" },
  SENT: { label: "Sent", className: "border-brand/25 bg-brand-soft text-brand" },
  BLOCKED: { label: "Blocked", className: "border-danger/25 bg-danger-soft text-danger" },
  CANCELLED: { label: "Cancelled", className: "" },
  FAILED: { label: "Failed", className: "border-danger/25 bg-danger-soft text-danger" },
  DISCARDED: { label: "Discarded", className: "" },
  SUPERSEDED: { label: "Replaced", className: "" },
};

export const TIMELINE_LABEL: Record<string, string> = {
  ConversationStarted: "Conversation started — cold sequence stopped",
  ConversationMessageReceived: "Message received",
  ConversationMessageClassified: "Message read",
  ConversationEscalated: "Sent to a person",
  ConversationReplyDrafted: "Reply drafted",
  ConversationReplySent: "Reply sent",
  ConversationModeChanged: "Mode changed",
  ConversationResolved: "Resolved",
  ConversationReopened: "Reopened",
  ConversationSnoozed: "Snoozed",
  ConversationAssigned: "Assigned",
  ConversationNoteAdded: "Note added",
  ConversationContextCorrected: "Fact corrected",
};

export const VALIDATOR_LABEL: Record<string, string> = {
  length: "Short enough",
  not_pushy: "Not pushy",
  no_links: "No links",
  no_emoji: "No emoji",
  no_placeholders: "No placeholders",
  pricing_authority: "No prices",
  no_commitments: "No promises",
  contact_validity: "No invented contacts",
  right_person: "Right name",
  questions_covered: "Every question handled",
  approved_knowledge: "Approved knowledge only",
  escalation: "Asks a person when unsure",
  grounding: "Claims backed by evidence",
};
