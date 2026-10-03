# 05 — Master Technical Specification Phase Order (LOCKED)

## Phase 1 — System Architecture
Next.js + NestJS API + Worker + PostgreSQL + Redis/BullMQ + AI layer + provider adapters, exact communication boundaries.

## Phase 2 — Database / Master Data Model
Company, Person, Market, Evidence, Contact Point, Campaign, Conversation, Message, Signal, Opportunity, Meeting, Memory, Knowledge, Task, Approval, Experiment, Policy, Audit, Event.

## Phase 3 — Event Architecture
company.discovered → company.resolved → research.completed → prospect.scored → email.sent → reply.received → meeting.booked → opportunity.won.

## Phase 4 — AI Agent Architecture
Market Hunter, Research, Contact, Signal, Campaign, Conversation, Qualification, Scheduling, Learning, AI Sales Manager; context/tools/authority per agent.

## Phase 5 — Workflow + State Machines
Lead → customer state transitions, retry, pause, cancellation, human takeover, resume behavior.

## Phase 6 — Policy & Permission Engine
Screen #16+#17 as backend rules: ACT/ASK/WAIT/BLOCK, RBAC, authority limits, confidence, grounding, suppression, approval logic.

## Phase 7 — Queue / Worker Architecture
Discovery/enrichment/verification/AI/email/signals/calendar/analytics jobs; priorities, retry, dead-letter, idempotency, concurrency.

## Phase 8 — Provider Architecture
EmailProvider, CalendarProvider, LeadProvider, EnrichmentProvider, VerificationProvider, LLMProvider, NotificationProvider, StorageProvider exact contracts.

## Phase 9 — Memory + Knowledge Architecture
AI Memory vs Business Brain separate; structured facts, vector retrieval, provenance, freshness, conflicts, context builder.

## Phase 10 — API Architecture
Frontend↔Backend endpoints, commands, queries, streaming/live updates, webhooks, internal boundaries.

## Phase 11 — Security + Reliability
Auth, authorization, encryption, secret management, audit, backups, rate limits, duplicate-send prevention, kill switch, disaster recovery.

## Phase 12 — Deployment Architecture
One VPS + Docker Compose (web/api/worker/Postgres/Redis/storage/reverse proxy/backups/monitoring); scaling path per component.

## Phase 13 — Implementation Roadmap
Controlled build order: foundation → core entities → Lead Hunter → AI → outreach → inbox → sales → intelligence.

## Rule
No code during these spec phases. Foundation first, then run sequence.
