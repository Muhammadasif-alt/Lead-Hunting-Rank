/**
 * Capability-first provider model (docs/12 §6-8). Domain code asks for a capability ("send an email"), never for a
 * vendor; the gateway picks an adapter that has it. Browser-safe — the web app imports these names too.
 */
export const CAPABILITIES = [
  'EMAIL_SEND',
  'EMAIL_READ',
  'CALENDAR_READ',
  'CALENDAR_WRITE',
  'COMPANY_SEARCH',
  'COMPANY_ENRICH',
  'PERSON_ENRICH',
  'EMAIL_VERIFY',
  'WEBSITE_FETCH',
  'LLM_REASONING',
  'LLM_EXTRACTION',
  'EMBEDDINGS',
  'STORAGE',
  'NOTIFY',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities whose call changes the outside world. Their unclear failures are "maybe it happened" — never retried blindly. */
export const SIDE_EFFECT_CAPABILITIES: ReadonlySet<Capability> = new Set(['EMAIL_SEND', 'CALENDAR_WRITE', 'NOTIFY']);

export const PROVIDER_CATEGORIES = ['EMAIL', 'CALENDAR', 'LEAD_DATA', 'ENRICHMENT', 'VERIFICATION', 'WEB', 'AI', 'STORAGE', 'NOTIFICATIONS'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

/** docs/12 §89-90 — an UNKNOWN cost is labelled as such, never given fake precision. */
export type CostModel = 'FREE' | 'PER_REQUEST' | 'PER_RESULT' | 'PER_CREDIT' | 'PER_TOKEN' | 'MONTHLY_POOL' | 'UNKNOWN';

/** Per-capability health (docs/12 §81-82). Not one green/red boolean. */
export const HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'UNAVAILABLE'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Worst first — an integration's overall status follows its worst capability. */
export const HEALTH_SEVERITY: Record<HealthState, number> = {
  AUTH_REQUIRED: 4,
  UNAVAILABLE: 3,
  RATE_LIMITED: 2,
  DEGRADED: 1,
  HEALTHY: 0,
};

/** Routing strategies (docs/12 §12). WATERFALL/PARALLEL/CONSENSUS arrive with Lead Hunter (Phase 7). */
export type RoutingStrategy = 'PRIMARY' | 'FALLBACK';
