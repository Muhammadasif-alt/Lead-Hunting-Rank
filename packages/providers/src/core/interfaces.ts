import type { Capability } from './capabilities.js';

/**
 * Typed capability interfaces (docs/12 §7-8, §37-68). Domain code only sees these canonical shapes — never a vendor
 * object. Provider A's `organization_name` and provider B's `companyName` both arrive as `CompanyObservation.name`;
 * the vendor's raw response is kept separately (as `raw`) for provenance.
 *
 * Every call receives an AbortSignal: the gateway enforces a timeout and adapters must stop when it fires.
 */

export interface CallOptions {
  signal: AbortSignal;
}

/** Result of a lightweight health probe. Must never cause a side effect (no real email in a health test — §118). */
export interface CapabilityCheck {
  capability: Capability;
  ok: boolean;
  detail?: string;
}

export interface ProviderAdapter {
  /** Catalog key, e.g. 'fake_email' or 'gmail'. */
  readonly key: string;
  healthCheck(options: CallOptions): Promise<CapabilityCheck[]>;
}

/** What a paid or metered call consumed — feeds ProviderCallRecord (docs/12 §42, §111). */
export interface Usage {
  units?: number;
  /** Minor currency units (cents). Omit when unknown — never invent a price. */
  costMinor?: number;
  costIsEstimate?: boolean;
}

// ───────────────────────────── email ─────────────────────────────

export interface SendEmailInput {
  from: string;
  /** Display name for From. */
  fromName?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  /** Provider thread to reply in, when continuing a conversation. */
  threadRef?: string;
  /** RFC 5322 Message-ID of the message this one follows up on (threads the follow-up for the recipient). */
  inReplyTo?: string;
  /** One-click unsubscribe endpoint (List-Unsubscribe header, RFC 8058). */
  unsubscribeUrl?: string;
  /** Our idempotency key, passed to the provider so a lost response can be reconciled (docs/12 §30). */
  idempotencyKey: string;
}

export interface SendEmailResult {
  messageId: string;
  threadId: string;
  sentAt: string;
  /** The RFC 5322 Message-ID header we set — what a follow-up's In-Reply-To points at. */
  internetMessageId?: string;
}

export interface EmailMessage {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  direction: 'OUTBOUND' | 'INBOUND';
  occurredAt: string;
  internetMessageId?: string;
}

export interface EmailChanges {
  messages: EmailMessage[];
  /** Pass back to continue from here (docs/12 §27-28 history/cursor sync). */
  cursor: string;
}

export interface EmailProvider extends ProviderAdapter {
  sendMessage(input: SendEmailInput, options: CallOptions): Promise<SendEmailResult & Usage>;
  /** Reconciliation: was a message with this idempotency key already sent? */
  findSentByIdempotencyKey(idempotencyKey: string, options: CallOptions, from?: string): Promise<SendEmailResult | null>;
  getMessage(messageId: string, options: CallOptions): Promise<EmailMessage | null>;
  getThread(threadId: string, options: CallOptions): Promise<EmailMessage[]>;
  listChanges(cursor: string | null, options: CallOptions): Promise<EmailChanges>;
}

// ───────────────────────────── calendar ─────────────────────────────

export interface TimeRange {
  start: string;
  end: string;
}

export interface CalendarEventInput extends TimeRange {
  calendarId: string;
  title: string;
  attendees: string[];
  description?: string;
  idempotencyKey: string;
}

export interface CalendarEvent extends TimeRange {
  eventId: string;
  calendarId: string;
  title: string;
  attendees: string[];
  status: 'CONFIRMED' | 'CANCELLED';
  /** Provider version (etag) — used to detect changes made outside Revenue OS (docs/12 §34-36). */
  etag: string;
}

export interface CalendarProvider extends ProviderAdapter {
  /** Busy blocks in a range. Always fresh — availability is never cached as truth (§33). */
  getBusy(calendarId: string, range: TimeRange, options: CallOptions): Promise<TimeRange[]>;
  createEvent(input: CalendarEventInput, options: CallOptions): Promise<CalendarEvent>;
  cancelEvent(calendarId: string, eventId: string, options: CallOptions): Promise<CalendarEvent>;
  getEvent(calendarId: string, eventId: string, options: CallOptions): Promise<CalendarEvent | null>;
  findEventByIdempotencyKey(idempotencyKey: string, options: CallOptions): Promise<CalendarEvent | null>;
}

// ───────────────────────────── lead discovery / enrichment / verification ─────────────────────────────

export interface CompanySearchInput {
  /** e.g. { country: 'US', region: 'TX', city: 'Austin' } */
  location: { country: string; region?: string; city?: string };
  industry: string;
  query?: string;
  cursor?: string | null;
  pageSize?: number;
}

/** One provider's view of a business. An observation, not a fact — entity resolution decides (docs/12 §16, §128). */
export interface CompanyObservation {
  sourceRecordId: string;
  name: string;
  domain: string | null;
  phone: string | null;
  address: { line1?: string; city?: string; region?: string; postalCode?: string; country: string } | null;
  category: string | null;
  observedAt: string;
  /** Vendor payload, kept for provenance. */
  raw: Record<string, unknown>;
}

export interface CompanySearchPage extends Usage {
  observations: CompanyObservation[];
  /** null = this query is exhausted at this provider. */
  nextCursor: string | null;
}

/** What a provider can search (docs/12 §38) so the query planner can choose sensibly. */
export interface SearchCapabilityMetadata {
  countries: string[];
  maxPageSize: number;
  geoPrecision: 'COUNTRY' | 'REGION' | 'CITY';
}

export interface LeadDiscoveryProvider extends ProviderAdapter {
  readonly searchMetadata: SearchCapabilityMetadata;
  searchCompanies(input: CompanySearchInput, options: CallOptions): Promise<CompanySearchPage>;
}

export interface EnrichmentResult extends Usage {
  /** Only what the provider actually returned. Missing stays missing — never invented (docs/12 §137). */
  fields: Record<string, string | number | null>;
  observedAt: string;
  raw: Record<string, unknown>;
}

export interface EnrichmentProvider extends ProviderAdapter {
  enrichCompany(input: { domain: string; fields: string[] }, options: CallOptions): Promise<EnrichmentResult>;
}

/** Canonical verification result (docs/12 §46). Proprietary vendor statuses stay in `rawStatus`. */
export type VerificationStatus = 'VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN';

export interface VerificationResult extends Usage {
  email: string;
  status: VerificationStatus;
  checkedAt: string;
  rawStatus: string;
}

export interface VerificationProvider extends ProviderAdapter {
  verifyEmail(email: string, options: CallOptions): Promise<VerificationResult>;
}

// ───────────────────────────── website ─────────────────────────────

/**
 * Why a page could not be read. A dead or slow website is a fact about that website, not a provider failure: it is
 * returned as data so it never opens the fetcher's circuit breaker or retries the job.
 */
export type PageFetchFailure = 'UNREACHABLE' | 'TIMEOUT' | 'BLOCKED' | 'TOO_LARGE' | 'NOT_HTML' | 'HTTP_ERROR' | 'TOO_MANY_REDIRECTS';

export interface FetchedPage extends Usage {
  requestedUrl: string;
  /** Where the redirects ended. */
  finalUrl: string;
  /** HTTP status of the last response; 0 when none arrived. */
  status: number;
  contentType: string | null;
  /** Decoded HTML (possibly cut at the size limit). Empty when the page could not be read. */
  body: string;
  bytes: number;
  truncated: boolean;
  fetchedAt: string;
  redirects: string[];
  failure: PageFetchFailure | null;
  failureDetail: string | null;
}

/** Controlled website reader (docs/12 §48-52). The only component allowed to fetch arbitrary URLs. */
export interface WebsiteProvider extends ProviderAdapter {
  fetchPage(url: string, options: CallOptions): Promise<FetchedPage>;
}

// ───────────────────────────── LLM ─────────────────────────────

/** Model classes (docs/12 §59) map to a concrete provider model in config. */
export type ModelClass = 'FAST' | 'STANDARD' | 'REASONING' | 'EXTRACTION';

export interface LlmRequest {
  modelClass: ModelClass;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface StructuredLlmRequest<T> extends LlmRequest {
  schema: OutputSchema<T>;
  schemaName: string;
  /** JSON Schema of the expected output, so a real model can be constrained to it (tool input schema). */
  jsonSchema?: Record<string, unknown>;
  /**
   * Test models only: the deterministic answer this caller would accept, used by the fake model when nothing is
   * scripted. Real providers ignore it. The answer is still schema-validated like any model output.
   */
  simulated?: () => unknown;
}

export interface LlmTextResult extends Usage {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Any schema with a `parse` that throws on invalid data — e.g. a zod schema. */
export interface OutputSchema<T> {
  parse(value: unknown): T;
}

export interface LlmStructuredResult<T> extends Omit<LlmTextResult, 'text'> {
  data: T;
}

export interface LLMProvider extends ProviderAdapter {
  generateText(request: LlmRequest, options: CallOptions): Promise<LlmTextResult>;
  /** Output is validated against `schema`; invalid output is an error, never passed on (docs/12 §62). */
  generateStructured<T>(request: StructuredLlmRequest<T>, options: CallOptions): Promise<LlmStructuredResult<T>>;
}

// ───────────────────────────── storage / notifications ─────────────────────────────

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  sha256: string;
}

/** Private object storage (docs/12 §65-66). The database keeps the key and metadata, not the bytes. */
export interface StorageProvider extends ProviderAdapter {
  put(key: string, body: Buffer, contentType: string, options: CallOptions): Promise<StoredObject>;
  get(key: string, options: CallOptions): Promise<{ body: Buffer; object: StoredObject } | null>;
  delete(key: string, options: CallOptions): Promise<void>;
}

export interface NotificationInput {
  /** User id or channel the notification is for. */
  recipient: string;
  title: string;
  body: string;
  link?: string;
  idempotencyKey: string;
}

/** Internal notifications, separate from domain logic (docs/12 §67-68). */
export interface NotificationProvider extends ProviderAdapter {
  notify(input: NotificationInput, options: CallOptions): Promise<{ notificationId: string }>;
}

/** Which adapter interface serves each capability — lets the gateway type its callbacks. */
export interface CapabilityAdapters {
  EMAIL_SEND: EmailProvider;
  EMAIL_READ: EmailProvider;
  CALENDAR_READ: CalendarProvider;
  CALENDAR_WRITE: CalendarProvider;
  COMPANY_SEARCH: LeadDiscoveryProvider;
  COMPANY_ENRICH: EnrichmentProvider;
  PERSON_ENRICH: EnrichmentProvider;
  EMAIL_VERIFY: VerificationProvider;
  WEBSITE_FETCH: WebsiteProvider;
  LLM_REASONING: LLMProvider;
  LLM_EXTRACTION: LLMProvider;
  EMBEDDINGS: LLMProvider;
  STORAGE: StorageProvider;
  NOTIFY: NotificationProvider;
}
