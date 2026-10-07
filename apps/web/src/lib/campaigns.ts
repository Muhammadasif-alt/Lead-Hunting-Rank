/** Shapes of the Campaigns API (`/api/v1/campaigns`, Phase 11) and display helpers. */

export type CampaignStatus = "DRAFT" | "READY" | "ACTIVE" | "PAUSED" | "BLOCKED" | "COMPLETED" | "ARCHIVED";
export type Objective = "START_CONVERSATIONS" | "BOOK_MEETINGS" | "QUOTE_REQUESTS" | "REENGAGE" | "VALIDATE_MARKET";
export type EnrollmentStatus =
  "ELIGIBLE" | "ENROLLED" | "ACTIVE" | "REPLIED" | "PAUSED" | "COMPLETED" | "REMOVED" | "SUPPRESSED" | "BLOCKED";
export type MessageStatus =
  "DRAFT_REJECTED" | "PENDING_APPROVAL" | "WAITING" | "QUEUED" | "SENT" | "BLOCKED" | "CANCELLED" | "FAILED";
export type FollowUpAngle = "CLARIFY_VALUE" | "NEW_OBSERVATION" | "CLOSE_THE_LOOP";

export interface AudienceFilter {
  marketId?: string | null;
  industries?: string[];
  opportunityKeys?: string[];
  priorities?: ("HIGH" | "MEDIUM" | "LOW")[];
}

export interface CampaignCheck {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
}

export interface Campaign {
  id: string;
  name: string;
  objective: Objective;
  status: CampaignStatus;
  statusReason: string | null;
  offer: string;
  audience: AudienceFilter;
  strategy: { cta?: string; tone?: string; avoid?: string[] };
  mailboxIntegrationId: string | null;
  senderName: string;
  cohortSize: number;
  dailyNewLimit: number;
  checks: CampaignCheck[] | null;
  checkedAt: string | null;
  launchedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  version: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  status: CampaignStatus;
  objective: Objective;
  launchedAt: string | null;
  createdAt: string;
  prospects: number;
  sent: number;
  replied: number;
  unsubscribed: number;
  needsApproval: number;
}

export interface FeedItem {
  type: "message" | "inbound";
  id: string;
  at: string;
  status: string;
  position: number | null;
  subject: string;
  reason: string | null;
  email: string;
  company: string | null;
  companyId: string | null;
}

export interface CampaignDetail {
  campaign: Campaign;
  steps: { id: string; position: number; kind: "FIRST_TOUCH" | "FOLLOW_UP"; delayDays: number; angle: string }[];
  mailbox: { id: string; name: string; provider: string; status: string; capabilities: string[] } | null;
  funnel: {
    enrolled: number;
    contacted: number;
    replied: number;
    unsubscribed: number;
    bounced: number;
    completed: number;
  };
  prospects: {
    active: number;
    replied: number;
    completed: number;
    suppressed: number;
    blocked: number;
    removed: number;
  };
  messages: {
    sent: number;
    pendingApproval: number;
    waiting: number;
    queued: number;
    blocked: number;
    cancelled: number;
    failed: number;
    rejectedDrafts: number;
  };
  inbound: { replies: number; autoReplies: number; unsubscribes: number; bounces: number };
  feed: FeedItem[];
}

export interface EnrollmentRow {
  id: string;
  company: { id: string; name: string | null };
  email: string;
  firstName: string | null;
  title: string | null;
  status: EnrollmentStatus;
  statusReason: string | null;
  nextStepPosition: number;
  nextStepDueAt: string | null;
  lastSentAt: string | null;
  repliedAt: string | null;
  enrolledAt: string;
  messages: {
    id: string;
    position: number;
    status: MessageStatus;
    statusReason: string | null;
    subject: string;
    body: string;
    claims: { text: string; evidenceIds: string[] }[];
    sentAt: string | null;
    externalActionId: string | null;
  }[];
}

export interface AudiencePreview {
  matched: number;
  eligible: number;
  excluded: {
    noVerifiedEmail: number;
    suppressed: number;
    inOtherCampaign: number;
    recentlyContacted: number;
    alreadyEnrolled: number;
  };
  sample: {
    companyId: string;
    companyName: string;
    name: string;
    title: string | null;
    email: string;
    priority: string | null;
    opportunityKeys: string[];
  }[];
}

export interface DraftPreview {
  company: { id: string; name: string };
  recipient: { name: string; title: string | null; email: string };
  status: string;
  reason: string | null;
  subject: string | null;
  body: string | null;
  claims: { text: string; evidenceIds: string[] }[];
  confidence: string | null;
  validation: { validator: string; ok: boolean; detail: string }[];
  policy: { decision: "ACT" | "ASK" | "WAIT" | "BLOCK"; reasonCodes: string[]; reasonSummary: string } | null;
}

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  START_CONVERSATIONS: "Start conversations",
  BOOK_MEETINGS: "Book qualified meetings",
  QUOTE_REQUESTS: "Get quote requests",
  REENGAGE: "Re-engage old contacts",
  VALIDATE_MARKET: "Validate a market",
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "" },
  READY: { label: "Ready to launch", className: "border-accent/25 bg-accent-soft text-accent" },
  ACTIVE: { label: "Running", className: "border-brand/25 bg-brand-soft text-brand" },
  PAUSED: { label: "Paused", className: "border-amber/30 bg-amber-soft text-amber" },
  BLOCKED: { label: "Blocked", className: "border-danger/25 bg-danger-soft text-danger" },
  COMPLETED: { label: "Completed", className: "" },
  ARCHIVED: { label: "Archived", className: "" },
};

export const ENROLLMENT_STATUS: Record<EnrollmentStatus, { label: string; className: string }> = {
  ELIGIBLE: { label: "Eligible", className: "" },
  ENROLLED: { label: "Enrolled", className: "" },
  ACTIVE: { label: "In sequence", className: "border-brand/25 bg-brand-soft text-brand" },
  REPLIED: { label: "Replied", className: "border-accent/25 bg-accent-soft text-accent" },
  PAUSED: { label: "Paused", className: "border-amber/30 bg-amber-soft text-amber" },
  COMPLETED: { label: "Finished", className: "" },
  REMOVED: { label: "Removed", className: "" },
  SUPPRESSED: { label: "Unsubscribed", className: "border-danger/25 bg-danger-soft text-danger" },
  BLOCKED: { label: "Stopped", className: "border-danger/25 bg-danger-soft text-danger" },
};

export const MESSAGE_STATUS: Record<MessageStatus, { label: string; className: string }> = {
  DRAFT_REJECTED: { label: "Draft rejected", className: "border-danger/25 bg-danger-soft text-danger" },
  PENDING_APPROVAL: { label: "Needs approval", className: "border-accent/25 bg-accent-soft text-accent" },
  WAITING: { label: "Waiting", className: "border-amber/30 bg-amber-soft text-amber" },
  QUEUED: { label: "Queued", className: "" },
  SENT: { label: "Sent", className: "border-brand/25 bg-brand-soft text-brand" },
  BLOCKED: { label: "Blocked", className: "border-danger/25 bg-danger-soft text-danger" },
  CANCELLED: { label: "Cancelled", className: "" },
  FAILED: { label: "Failed", className: "border-danger/25 bg-danger-soft text-danger" },
};

export const INBOUND_LABEL: Record<string, string> = {
  REPLY: "Replied",
  AUTO_REPLY: "Auto-reply",
  UNSUBSCRIBE: "Unsubscribed by reply",
  BOUNCE: "Bounced",
  UNMATCHED: "Unmatched email",
};

export const ANGLE_LABEL: Record<string, string> = {
  FIRST_TOUCH: "First email",
  CLARIFY_VALUE: "Clarify the value",
  NEW_OBSERVATION: "A new observation",
  CLOSE_THE_LOOP: "Close the loop politely",
};

/** Opportunity keys from research (rule hypotheses) a campaign can target. */
export const OPPORTUNITY_KEYS: { key: string; label: string }[] = [
  { key: "NO_WEBSITE", label: "No website" },
  { key: "WEBSITE_UNREACHABLE", label: "Website unreachable" },
  { key: "NO_ONLINE_BOOKING", label: "No online booking" },
  { key: "NO_CONTACT_FORM", label: "No contact form" },
  { key: "NO_CLEAR_CTA", label: "No clear call to action" },
  { key: "NOT_MOBILE_READY", label: "Not mobile-ready" },
  { key: "NO_SSL", label: "No https" },
  { key: "OUTDATED_SITE", label: "Outdated website" },
  { key: "NO_CHAT", label: "No live chat" },
];
