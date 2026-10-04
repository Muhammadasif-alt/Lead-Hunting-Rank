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
}

export type EventType = keyof EventPayloads;

export type AggregateType = 'WORKSPACE' | 'COMPANY' | 'PERSON' | 'EMPLOYMENT' | 'CONTACT_POINT' | 'EVIDENCE' | 'FACT' | 'EXTERNAL_ACTION';

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
  owner: 'identity' | 'crm' | 'evidence' | 'execution';
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
};

export function eventDefinition(type: string): EventDefinition | undefined {
  return Object.hasOwn(EVENTS, type) ? EVENTS[type as EventType] : undefined;
}
