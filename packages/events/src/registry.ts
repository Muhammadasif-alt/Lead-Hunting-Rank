import { JOBS, PRIORITY, QUEUES, type JobName, type QueueName } from '@revenue-os/shared';

/**
 * Event registry (docs/07 §125). Every domain event the system emits is declared here: its payload, version,
 * owning module, PII class, whether replaying it is safe, and which consumers (queue jobs) it fans out to.
 *
 * Rules:
 * - Names are past-tense business language (CompanyCreated, not CompanyThingUpdated) — docs/07 §123.
 * - Payloads carry IDs and minimal business data, never whole rows or message bodies (docs/07 §89, §132).
 * - An incompatible payload change is a new version; old versions stay readable (docs/07 §88).
 * - Replaying an event never re-executes an external side effect (docs/07 §79-80): routes that lead to one
 *   go through ExternalAction, whose idempotency key and state machine make a replay a no-op.
 */
export interface EventPayloads {
  // identity
  WorkspaceCreated: { slug: string; ownerUserId: string };
  MemberAdded: { memberId: string; userId: string; role: string };
  // crm
  CompanyCreated: { companyId: string; displayName: string; websiteDomain: string | null };
  CompanyUpdated: { companyId: string; version: number; changedFields: string[] };
  PersonCreated: { personId: string };
  EmploymentAttached: { employmentId: string; personId: string; companyId: string };
  ContactPointAdded: { contactPointId: string; entityType: string; entityId: string; type: string };
  CompanyArchived: { companyId: string; reason: string | null };
  CompanyRestored: { companyId: string };
  PersonUpdated: { personId: string; version: number; changedFields: string[] };
  EmploymentEnded: { employmentId: string; personId: string; companyId: string };
  ContactPointUpdated: { contactPointId: string; entityType: string; entityId: string; changedFields: string[] };
  ContactPointArchived: { contactPointId: string; entityType: string; entityId: string };
  // entity resolution (docs/17 §40-45)
  DuplicateCandidateDetected: { candidateId: string; entityType: string; leftId: string; rightId: string; score: number; confidence: string };
  DuplicateCandidateRejected: { candidateId: string; entityType: string; leftId: string; rightId: string };
  /** Source was merged into target; the source row is archived and kept for history. */
  CompaniesMerged: { mergeId: string; sourceCompanyId: string; targetCompanyId: string; mode: 'MANUAL' | 'AUTO'; candidateId: string | null };
  // discovery (docs/07 §60-62, docs/17 §46-51)
  MarketCreated: { marketId: string; marketKey: string };
  DiscoveryMissionStarted: { missionId: string; marketId: string; mode: string };
  /** A round finished and coverage was assessed. `decision` CONTINUE schedules the next round. */
  DiscoveryRoundCompleted: { missionId: string; round: number; newUnique: number; cumulativeUnique: number; decision: 'CONTINUE' | 'COMPLETE' };
  DiscoveryMissionPaused: { missionId: string; reason: string | null };
  DiscoveryMissionResumed: { missionId: string; status: string };
  DiscoveryMissionWaiting: { missionId: string; reason: string; retryAt: string };
  DiscoveryMissionBlocked: { missionId: string; reason: string };
  DiscoveryMissionCompleted: { missionId: string; stopReason: string; coverageConfidence: string; uniqueCompanies: number };
  DiscoveryMissionFailed: { missionId: string; reason: string };
  /** A mission found a business (new or already known) — research/enrichment eligibility hooks here (Phase 8). */
  CompanyDiscovered: { companyId: string; missionId: string; observationId: string; provider: string; outcome: 'CREATED' | 'MATCHED_EXISTING' };
  // research (docs/17 §52-57)
  /** A person asked for research; the run waits in QUEUED for a worker. */
  ResearchRequested: { runId: string; companyId: string };
  ResearchRunStarted: { runId: string; companyId: string; trigger: string };
  /** PARTIAL = useful results with named gaps (e.g. no verifier connected). */
  ResearchRunCompleted: { runId: string; companyId: string; status: 'COMPLETED' | 'PARTIAL'; hypotheses: number; gaps: number };
  ResearchRunFailed: { runId: string; companyId: string; reason: string };
  WebsiteAudited: { websiteId: string; companyId: string; auditId: string; auditVersion: number; status: string };
  /** A rule (Phase 9: AI) proposed why the company may need us — a hypothesis, not a verified pain. */
  OpportunityHypothesisProposed: { hypothesisId: string; companyId: string; key: string; confidence: string };
  OpportunityHypothesisInvalidated: { hypothesisId: string; companyId: string; key: string; reason: string };
  ContactPointVerified: { contactPointId: string; entityType: string; entityId: string; status: string; provider: string };
  // evidence
  EvidenceRecorded: { evidenceId: string; entityType: string; entityId: string; sourceType: string };
  FactRecorded: { factId: string; entityType: string; entityId: string; field: string; outcome: 'CREATED' | 'CONFIRMED' };
  FactConflicted: { factId: string; conflictingFactIds: string[]; entityType: string; entityId: string; field: string };
  FactSuperseded: { factId: string; supersededFactIds: string[]; entityType: string; entityId: string; field: string };
  // external actions (docs/11 §18-29)
  ExternalActionPrepared: { externalActionId: string; actionType: string; provider: string };
  ExternalActionQueued: { externalActionId: string; actionType: string };
  ExternalActionSucceeded: { externalActionId: string; actionType: string; providerRef: string; attempt: number };
  ExternalActionFailed: { externalActionId: string; actionType: string; reason: string; attempt: number };
  ExternalActionBlocked: { externalActionId: string; actionType: string; reason: string };
  ExternalActionCancelled: { externalActionId: string; actionType: string; reason: string };
  ExternalActionWaiting: { externalActionId: string; actionType: string; reason: string };
  /** A worker's claim expired mid-call (crash). The consumer reconciles with the provider — never blindly resends. */
  ExternalActionClaimExpired: { externalActionId: string; actionType: string; claimedAt: string };
  /** Reconciliation could not tell whether the provider acted. A human decides (Phase 21 turns this into attention). */
  ExternalActionNeedsReview: { externalActionId: string; actionType: string; reason: string };
  // integrations (docs/12 §129) — never carry credentials
  IntegrationConnected: { integrationId: string; provider: string; reconnected: boolean };
  IntegrationDisconnected: { integrationId: string; provider: string };
  IntegrationDisabled: { integrationId: string; provider: string };
  IntegrationEnabled: { integrationId: string; provider: string };
  /** Capability health transitions, observed from real calls or health checks. */
  IntegrationDegraded: ProviderHealthPayload;
  IntegrationAuthExpired: ProviderHealthPayload;
  ProviderRateLimited: ProviderHealthPayload;
  ProviderUnavailable: ProviderHealthPayload;
  ProviderRecovered: ProviderHealthPayload;
}

export interface ProviderHealthPayload {
  integrationId: string;
  provider: string;
  capability: string;
  from: string | null;
  to: string;
  reason: string | null;
}

export type EventType = keyof EventPayloads;

export type AggregateType =
  | 'WORKSPACE'
  | 'COMPANY'
  | 'PERSON'
  | 'EMPLOYMENT'
  | 'CONTACT_POINT'
  | 'EVIDENCE'
  | 'FACT'
  | 'EXTERNAL_ACTION'
  | 'INTEGRATION'
  | 'ENTITY_MATCH_CANDIDATE'
  | 'MARKET'
  | 'DISCOVERY_MISSION'
  | 'WEBSITE'
  | 'RESEARCH_RUN'
  | 'OPPORTUNITY_HYPOTHESIS';

/** An outbox row as the dispatcher sees it, used to build consumer job payloads. */
export interface DispatchedEvent {
  outboxId: string;
  domainEventId: string | null;
  eventType: string;
  eventVersion: number;
  workspaceId: string | null;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
}

export interface EventRoute {
  /** Stable consumer name; part of the job id, so the same event is enqueued at most once per consumer. */
  consumer: string;
  queue: QueueName;
  job: JobName;
  priority: number;
  /** Minimal job payload (IDs + intent). Tracing fields are added by the dispatcher. */
  toJobData: (event: DispatchedEvent) => Record<string, unknown>;
}

export interface EventDefinition {
  version: number;
  owner: 'identity' | 'crm' | 'evidence' | 'execution' | 'integrations' | 'discovery' | 'research';
  aggregateType: AggregateType;
  description: string;
  pii: 'none' | 'low';
  replaySafe: boolean;
  routes: EventRoute[];
}

const executeExternalAction: EventRoute = {
  consumer: 'outbound.execute-external-action',
  queue: QUEUES.outbound,
  job: JOBS.externalActionExecute,
  priority: PRIORITY.NORMAL,
  toJobData: (e) => ({ externalActionId: e.aggregateId, schemaVersion: 1 }),
};

/** Discovery work runs one bounded round per job; the job reloads the mission and continues from its DB state. */
const advanceMission: EventRoute = {
  consumer: 'discovery.advance-mission',
  queue: QUEUES.discovery,
  job: JOBS.discoveryAdvance,
  priority: PRIORITY.BACKGROUND,
  toJobData: (e) => ({ missionId: e.aggregateId, schemaVersion: 1 }),
};

/** Research of one company; the job reloads the company and decides whether a run is due (docs/11 §76 research dedupe). */
const researchCompany: EventRoute = {
  consumer: 'research.discovered-company',
  queue: QUEUES.research,
  job: JOBS.researchRun,
  priority: PRIORITY.BACKGROUND,
  toJobData: (e) => ({ companyId: e.payload.companyId, missionId: e.payload.missionId, trigger: 'DISCOVERY', schemaVersion: 1 }),
};

const entity = (owner: EventDefinition['owner'], aggregateType: AggregateType, description: string, pii: 'none' | 'low' = 'none'): EventDefinition => ({
  version: 1,
  owner,
  aggregateType,
  description,
  pii,
  replaySafe: true,
  routes: [],
});

export const EVENTS: { [K in EventType]: EventDefinition } = {
  WorkspaceCreated: entity('identity', 'WORKSPACE', 'A workspace was created with its owner'),
  MemberAdded: entity('identity', 'WORKSPACE', 'A user joined a workspace with a role'),
  CompanyCreated: entity('crm', 'COMPANY', 'A canonical company record was created', 'low'),
  CompanyUpdated: entity('crm', 'COMPANY', 'Company fields changed (names of the fields, not values)'),
  PersonCreated: entity('crm', 'PERSON', 'A person record was created'),
  EmploymentAttached: entity('crm', 'EMPLOYMENT', 'A person was linked to a company'),
  ContactPointAdded: entity('crm', 'CONTACT_POINT', 'An email/phone/… was added to a person or company'),
  CompanyArchived: entity('crm', 'COMPANY', 'A company was archived (kept for history, hidden from lists)'),
  CompanyRestored: entity('crm', 'COMPANY', 'An archived company was restored'),
  PersonUpdated: entity('crm', 'PERSON', 'Person fields changed (names of the fields, not values)'),
  EmploymentEnded: entity('crm', 'EMPLOYMENT', 'A person no longer works at a company (history kept)'),
  ContactPointUpdated: entity('crm', 'CONTACT_POINT', 'A contact point changed (e.g. became primary)'),
  ContactPointArchived: entity('crm', 'CONTACT_POINT', 'A contact point was removed from use (kept for history)'),
  DuplicateCandidateDetected: entity('crm', 'ENTITY_MATCH_CANDIDATE', 'Two records may be the same business — review needed'),
  DuplicateCandidateRejected: entity('crm', 'ENTITY_MATCH_CANDIDATE', 'A human said two records are different businesses'),
  CompaniesMerged: entity('crm', 'COMPANY', 'Two company records were merged; source history preserved'),
  MarketCreated: entity('discovery', 'MARKET', 'A market (territory + industry) was defined'),
  DiscoveryMissionStarted: { ...entity('discovery', 'DISCOVERY_MISSION', 'A discovery mission was started'), routes: [advanceMission] },
  DiscoveryRoundCompleted: {
    ...entity('discovery', 'DISCOVERY_MISSION', 'A discovery round finished and coverage was assessed'),
    routes: [{ ...advanceMission, consumer: 'discovery.next-round' }],
  },
  DiscoveryMissionPaused: entity('discovery', 'DISCOVERY_MISSION', 'A person paused a discovery mission'),
  DiscoveryMissionResumed: { ...entity('discovery', 'DISCOVERY_MISSION', 'A paused, waiting or blocked mission continues'), routes: [{ ...advanceMission, consumer: 'discovery.resume-mission' }] },
  DiscoveryMissionWaiting: entity('discovery', 'DISCOVERY_MISSION', 'A mission waits on a temporary dependency (e.g. rate limit)'),
  DiscoveryMissionBlocked: entity('discovery', 'DISCOVERY_MISSION', 'A mission cannot continue until something changes (e.g. no lead source)'),
  DiscoveryMissionCompleted: entity('discovery', 'DISCOVERY_MISSION', 'A mission finished by its stopping criteria (not a claim of 100% coverage)'),
  DiscoveryMissionFailed: entity('discovery', 'DISCOVERY_MISSION', 'A mission failed unrecoverably'),
  CompanyDiscovered: { ...entity('discovery', 'COMPANY', 'A discovery mission found a business (new or already known)'), routes: [researchCompany] },
  ResearchRequested: {
    ...entity('research', 'RESEARCH_RUN', 'A person asked for a company to be researched'),
    // A person is waiting for it: ahead of background research from discovery.
    routes: [{ ...researchCompany, consumer: 'research.run-requested', priority: PRIORITY.NORMAL, toJobData: (e) => ({ runId: e.aggregateId, companyId: e.payload.companyId, trigger: 'MANUAL', schemaVersion: 1 }) }],
  },
  ResearchRunStarted: entity('research', 'RESEARCH_RUN', 'Research of a company started'),
  ResearchRunCompleted: entity('research', 'RESEARCH_RUN', 'Research finished (COMPLETED, or PARTIAL with named gaps)'),
  ResearchRunFailed: entity('research', 'RESEARCH_RUN', 'Research of a company failed unrecoverably'),
  WebsiteAudited: entity('research', 'WEBSITE', 'Deterministic website checks were recorded'),
  OpportunityHypothesisProposed: entity('research', 'OPPORTUNITY_HYPOTHESIS', 'A possible need was proposed from observed facts (not verified)'),
  OpportunityHypothesisInvalidated: entity('research', 'OPPORTUNITY_HYPOTHESIS', 'A later observation no longer supports a hypothesis'),
  ContactPointVerified: entity('research', 'CONTACT_POINT', 'A verification provider checked an email (VALID/INVALID/RISKY/CATCH_ALL/UNKNOWN)', 'low'),
  EvidenceRecorded: entity('evidence', 'EVIDENCE', 'Evidence from a source was stored'),
  FactRecorded: entity('evidence', 'FACT', 'A fact was created or confirmed by new evidence'),
  FactConflicted: entity('evidence', 'FACT', 'New evidence disagrees with an existing fact — needs resolution'),
  FactSuperseded: entity('evidence', 'FACT', 'A fact explicitly replaced an older one'),
  ExternalActionPrepared: entity('execution', 'EXTERNAL_ACTION', 'An external side effect was prepared with an idempotency key'),
  ExternalActionQueued: {
    ...entity('execution', 'EXTERNAL_ACTION', 'An external action is ready to execute'),
    routes: [executeExternalAction],
  },
  ExternalActionSucceeded: entity('execution', 'EXTERNAL_ACTION', 'The provider confirmed the side effect'),
  ExternalActionFailed: entity('execution', 'EXTERNAL_ACTION', 'The side effect failed permanently or ran out of retries'),
  ExternalActionBlocked: entity('execution', 'EXTERNAL_ACTION', 'Revalidation before execution blocked the action'),
  ExternalActionCancelled: entity('execution', 'EXTERNAL_ACTION', 'The action was cancelled before execution'),
  ExternalActionWaiting: entity('execution', 'EXTERNAL_ACTION', 'The action waits on a condition (e.g. provider re-auth)'),
  ExternalActionClaimExpired: {
    ...entity('execution', 'EXTERNAL_ACTION', 'A worker died while executing; outcome must be reconciled'),
    routes: [{ ...executeExternalAction, consumer: 'outbound.reconcile-external-action', priority: PRIORITY.HIGH }],
  },
  ExternalActionNeedsReview: entity('execution', 'EXTERNAL_ACTION', 'Outcome unknown after reconciliation — human review'),
  IntegrationConnected: entity('integrations', 'INTEGRATION', 'A workspace connected (or reconnected) a provider'),
  IntegrationDisconnected: entity('integrations', 'INTEGRATION', 'A provider was disconnected; history and mappings are kept'),
  IntegrationDisabled: entity('integrations', 'INTEGRATION', 'New provider calls through this integration were stopped'),
  IntegrationEnabled: entity('integrations', 'INTEGRATION', 'A disabled integration was turned back on'),
  IntegrationDegraded: entity('integrations', 'INTEGRATION', 'A capability is failing intermittently'),
  IntegrationAuthExpired: entity('integrations', 'INTEGRATION', 'The provider no longer accepts our credentials — reconnect needed'),
  ProviderRateLimited: entity('integrations', 'INTEGRATION', 'The provider asked us to slow down for a capability'),
  ProviderUnavailable: entity('integrations', 'INTEGRATION', 'A capability is down (circuit open)'),
  ProviderRecovered: entity('integrations', 'INTEGRATION', 'A capability is healthy again'),
};

export function eventDefinition(type: string): EventDefinition | undefined {
  return Object.hasOwn(EVENTS, type) ? EVENTS[type as EventType] : undefined;
}
