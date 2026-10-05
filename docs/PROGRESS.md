# Build Progress

Build order source: [17-tech-spec-13-implementation-roadmap.md](17-tech-spec-13-implementation-roadmap.md).
Rule: vertical slices (DB → API → UI → Evidence → Event → Audit → Test). Har phase ka "Definition of Done" pura ho tab agla.

**Specification phase:** ✅ complete (Tech Specs #1–#13 locked, 18 screen specs locked).

| Phase | Name | Status |
|---|---|---|
| 0 | Engineering Setup | ✅ done 2026-10-04 |
| 1 | Platform Foundation (logging, request/correlation IDs, error taxonomy) | ✅ done 2026-10-04 |
| 2 | Database Foundation | ✅ done 2026-10-04 |
| 3 | Authentication + RBAC | ✅ done 2026-10-04 |
| 4 | Events + Outbox + Queue | ✅ done 2026-10-04 |
| 5 | Provider Gateway (fake providers first) | ✅ done 2026-10-04 |
| 6 | CRM Core — Company 360 | ✅ done 2026-10-04 |
| 7 | Lead Hunter — Market Exhaust | ✅ done 2026-10-05 |
| 8 … 24 | Research → AI → Policy → Campaigns → Inbox → … → Autonomy rollout | ⬜ |

## Phase 0 — Definition of Done
- [x] Monorepo: `apps/web`, `apps/api`, `apps/worker`, `packages/*`, one pnpm workspace + lockfile
- [x] Root config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, Prettier, `.gitignore`, `.env.example`, README
- [x] Web / API / Worker all build + typecheck
- [x] Environment validation (`packages/config`) — missing/invalid `.env` fails with a clear message
- [x] Dev Docker stack defined (`infrastructure/docker/docker-compose.dev.yml`: Postgres+pgvector, Redis)
- [x] Diagnostics: `GET /api/health` + web page `/diagnostics` (Web/API/Postgres/Redis/Worker)
- [x] Browser → Next.js → NestJS verified
- [x] NestJS → PostgreSQL verified (2026-10-04, Docker pgvector/pg17 on :5433)
- [x] NestJS → Redis → BullMQ → Worker job verified (2026-10-04, Redis on :6380)
- [x] CI basic checks pass on GitHub (install → typecheck → build), 2026-10-04

## Phase 1 — Definition of Done
- [x] Typed config: DB/Redis/APP_ENV/APP_URL/LOG_*/LLM/storage/encryption; startup fails clearly (`packages/config`)
- [x] Structured logging (pino) with secret redaction; pretty in dev, JSON elsewhere (`@revenue-os/shared/server`)
- [x] Every request/job carries requestId / correlationId (+ workspaceId / actorId slots for Phase 3) via AsyncLocalStorage
- [x] Correlation flows API → BullMQ job → worker logs; client `x-correlation-id` accepted only if safe
- [x] Error taxonomy (Validation/Forbidden/AuthorityExceeded/NotFound/Conflict/BusinessRule/Policy/Provider/RateLimited) → `{ error: { code, message, details, requestId } }`; unknown errors → 500 without leaking internals
- [x] Success envelope `{ data, meta: { requestId } }`, `/api/v1` URI versioning
- [x] Zod validation pipe (strict objects reject unknown fields)
- [x] Health split: `/api/health/live`, `/api/health/ready`, `/api/health` (full diagnostics)
- [x] Unit tests (`pnpm test`, Node test runner) + CI runs them

## Phase 2 — Definition of Done
- [x] Identity: Workspace, User, WorkspaceMember, Role (per workspace), Permission (catalog), RolePermission (ALLOW/DENY + scope), UserRole, AuthorityLimit
- [x] System tables early: AuditLog (append-only via DB trigger), DomainEvent, OutboxEvent, ExternalAction (unique idempotency key), InboundEvent (unique provider + external id)
- [x] CRM core: Company, CompanyAlias, ExternalEntityMapping, Person, Employment, ContactPoint, ContactVerification, Evidence, Fact, FactEvidence
- [x] Constraints from day one: FKs, uniques, enums, `version` fields, CHECKs, one-primary-contact index; child rows use composite `(workspaceId, id)` FKs so cross-workspace links are impossible in Postgres itself
- [x] Dev seed (`pnpm db:seed`, idempotent): workspace, owner user, 5 roles + grants, authority limits, default pipeline (7 stages), hard-safety policy skeleton
- [x] Application services (`apps/api/src/modules`): create workspace/member, company (+aliases, optimistic concurrency), person, employment, contact point (unverified by default), evidence, fact (confirm / conflict / explicit supersede — never blind overwrite); every change audited in the same transaction
- [x] Integration tests against a real `revenue_os_test` database (`pnpm test`), CI runs them with a Postgres service

## Phase 3 — Definition of Done
- [x] Login / logout / server-side sessions: random token in an HttpOnly + SameSite=Lax cookie (Secure in production), only its SHA-256 stored; 12 h idle timeout + 7 day absolute lifetime; list + revoke sessions
- [x] Password security: Argon2id (Node built-in, OWASP parameters), length-based policy + common-password block, generic errors and constant-ish timing (no account enumeration), per-account + per-IP lockout in Redis (429), step-up re-check to change password (revokes other sessions)
- [x] CSRF: state-changing requests must come from our own origin (applies to login too)
- [x] Global guards, fail-closed: Authentication → Workspace (membership verified server-side, `x-workspace-id` can't reach other workspaces) → Permission (`@RequirePermission`) → Scope; `@Public()` opt-out only for login/logout/health
- [x] Role + permission resolution with DENY-wins, authority limits (role, member override, `null` = unlimited); AccessService answers: launch campaign? approve discount? change policy? resume emergency stop?
- [x] Seeded roles OWNER/ADMIN/SALES/RESEARCHER/VIEWER + one dev user per role (`pnpm db:seed`)
- [x] RBAC tests: cross-workspace denied, viewer cannot write, researcher cannot send, sales cannot change policy, admin respected (owner-only ops held back), owner authority, deny wins, member override, suspended member; HTTP e2e: cookies, 401/403/429, CSRF, logout revocation
- [x] Web: `/login` page, `proxy.ts` optimistic redirect, `(app)` layout validates the session with the API, user menu with sign-out; landing "Sign in" → `/login`
- Deferred by plan: password reset email (needs Email provider, Phase 5/10), MFA enforcement for OWNER/ADMIN (Phase 22 hardening — schema is MFA-ready), invite acceptance flow (Team & Roles, Phase 21)

## Phase 4 — Definition of Done
- [x] `packages/events` (`@revenue-os/events`): event registry (payload type, version, owner, PII class, replay-safe, consumer routes), transactional outbox writer `recordEvent(tx, …)` — DomainEvent + OutboxEvent in the caller's transaction; correlation (workflow) + causation (direct cause) IDs
- [x] Phase 2 services now emit events in the same transaction as their change (WorkspaceCreated, MemberAdded, CompanyCreated/Updated, PersonCreated, EmploymentAttached, ContactPointAdded, EvidenceRecorded, FactRecorded/Conflicted/Superseded); DomainEvent is append-only (DB trigger)
- [x] Outbox dispatcher: `FOR UPDATE SKIP LOCKED` batches, deterministic job ids (outbox id + consumer), backoff on publish failure, DEAD after max attempts, unknown types parked; runs in the worker (`startOutboxLoop`)
- [x] Queues: environment-prefixed (`rhl:<APP_ENV>`), priority classes, minimal versioned job payloads
- [x] Shared worker wrapper (`createQueueWorker`): correlation context, time budget, failure classification (TRANSIENT/RATE_LIMIT/AUTH/VALIDATION/POLICY/NOT_FOUND/PERMANENT/UNKNOWN), exponential backoff + jitter or provider Retry-After, POLICY = business outcome (no DLQ), metrics + Redis heartbeat
- [x] DLQ in Postgres (`DeadLetterRecord`): failure category, attempts, entity, correlation; admin list / retry (revalidates current state) / dismiss — audited; retried job updates the same record
- [x] Consumer idempotency: `InboxReceipt` + `processOnce()`
- [x] ExternalAction state machine PREPARED → (WAITING_APPROVAL → APPROVED →) QUEUED → EXECUTING → SUCCEEDED, with WAITING / BLOCKED / FAILED / CANCELLED / UNKNOWN_OUTCOME; frozen payload + hash, IDEMPOTENCY_CONFLICT on a changed payload; atomic claim; revalidation right before the provider call (Policy/kill switch plug in at Phase 10); SUCCEEDED can't change (DB trigger)
- [x] Crash safety: lost provider response → UNKNOWN_OUTCOME → reconcile with provider (never blind resend); stale EXECUTING claims swept every minute → reconciled
- [x] Idempotency proven with a fake provider (no built-in dedupe): same logical send delivered 10× (and 10× concurrently) → one external effect
- [x] DoD e2e test: HTTP command → DB transaction → Outbox → Dispatcher → BullMQ (real Redis) → Worker → Fake provider → Result → Event
- [x] System Health screen: event pipeline stats, live end-to-end test (with simulated 429 / lost response), queues, workers, failed jobs (needs `system.read` / `system.manage` — OWNER, ADMIN)

## Phase 5 — Definition of Done
- [x] `packages/providers` (`@revenue-os/providers`): capability-first model (EMAIL_SEND/READ, CALENDAR_READ/WRITE, COMPANY_SEARCH, EMAIL_VERIFY, LLM_*, STORAGE, NOTIFY…), typed interfaces — EmailProvider, CalendarProvider, LeadDiscoveryProvider, EnrichmentProvider, VerificationProvider, LLMProvider, StorageProvider, NotificationProvider — with canonical inputs/outputs (vendor payload kept as `raw` for provenance)
- [x] Normalized provider error taxonomy (AUTH_REQUIRED/PERMISSION_DENIED/RATE_LIMITED/QUOTA_EXCEEDED/UNAVAILABLE/NOT_FOUND/INVALID_REQUEST/TRANSIENT/UNKNOWN_OUTCOME/PERMANENT) mapped onto the shared errors, so ExternalAction semantics hold: refused → retry, auth → WAITING, unclear side effect → reconcile
- [x] Provider Gateway: router over the workspace's integrations (priority order, PRIMARY/FALLBACK — never falls back after an unclear side effect), circuit breaker (open → reject → single half-open probe), per-integration+capability rate limits, hard timeouts with AbortSignal, no hidden retries (the queue owns retries)
- [x] Shared limiter/circuit state in Redis (all workers see one number); in-memory store for tests
- [x] Provider health per capability (HEALTHY/DEGRADED/RATE_LIMITED/AUTH_REQUIRED/UNAVAILABLE) from real call outcomes + active side-effect-free checks (Test connection, 5-minute sweep in the worker); transitions emit IntegrationDegraded / IntegrationAuthExpired / ProviderRateLimited / ProviderUnavailable / ProviderRecovered; integration status follows its worst capability
- [x] Usage tracking: `ProviderCallRecord` per call — status, error kind, latency, units, cost (null = unknown, never invented), entity, correlation
- [x] Fake providers first: FakeEmail (Redis-backed mailbox in dev, reconcilable by idempotency key, no built-in dedupe), FakeCalendar (repeatable busy blocks, refuses busy slots), FakeLead (repeatable markets, pagination, no-website businesses, duplicate listings), FakeVerification (every canonical status on purpose), FakeLLM (scripted, schema-validated), FakeNotification; real LocalStorage (path-traversal safe, per-workspace directory). Fakes are never connectable in production
- [x] `email.send` ExternalAction executor through the gateway: pinned to the mailbox it was prepared for, exactly-once proven (replay, lost response → reconcile, 429 → re-queue, auth → WAITING, no integration → WAITING, bad payload → FAILED)
- [x] Integrations API (`/api/v1/integrations`: list, catalog, usage, connect, test, disable, enable, disconnect) — audited, events in the same transaction, reconnect restores the same identity, no credential fields leave the API; `integration.read` (all roles) / `integration.manage` (owner, admin)
- [x] Integrations screen (#15) live: connected cards with capability health, 24 h calls/failures/latency/cost, Test/Disable/Enable/Disconnect, available test providers, planned vendors shown honestly with their phase
- Deferred by plan: credential storage + OAuth (with the first real vendor — Anthropic Phase 9, Gmail Phase 10), webhooks/polling cursors (Gmail sync, Phase 11), budget reservation for paid calls and WATERFALL/PARALLEL/CONSENSUS routing (Lead Hunter, Phase 7)

## Phase 6 — Definition of Done
- [x] Company 360 V1 answers the six questions: who are they (profile, status, aliases), where did the data come from (record origin, evidence sources, provider ids), who works there (current + former employment), how can we contact them (company + person contact points, honestly UNVERIFIED until a verification exists), what do we know (facts with their evidence), how fresh is it (per fact and per company, from evidence observed_at — FRESH ≤ 90 d, AGING ≤ 180 d, STALE)
- [x] Company list (search by name/website/phone/city, status filter, cursor pagination, duplicate + freshness badges), create with a live duplicate preview, edit (optimistic concurrency), archive / restore as explicit commands (no status PATCH)
- [x] People: add a person to a company in one transaction, edit, end employment (history kept), no duplicate person at one company; contact points: add, make primary, archive (re-adding restores the same row)
- [x] Evidence + facts from the UI: "Record what you found" stores Evidence and Fact in one transaction; a different value makes both CONFLICTED ("needs verification") and a human picks the correct one (rivals SUPERSEDED, evidence kept)
- [x] Entity resolution foundation: normalized name / domain / phone / address keys, aliases, external mappings, trigram name similarity (pg_trgm), deterministic scoring (`scoreCompanyMatch` in `@revenue-os/shared`, browser-safe and reusable by Lead Hunter) with matching and conflicting signals; shared hosts (facebook.com, yelp.com…) never count as a match
- [x] EntityMatchCandidate instead of auto-merge: LOW → PENDING, MEDIUM/HIGH → NEEDS_REVIEW; a rejected pair is never proposed again; candidates close themselves when an edit removes the similarity or a record is archived; concurrent creates of the same business are serialized with transaction-scoped advisory locks so no pair is missed
- [x] Auto-merge only where safe: HIGH confidence, zero conflicts, same website plus name or phone, and only for records created by the system/integrations — a record a person typed in is never merged without a person
- [x] Merge preserves source history: people, contact points (identical ones archived, not lost), evidence (original source + observed_at), facts (same value → one fact with both sources; different values → CONFLICTED), provider mappings and aliases move to the survivor; empty fields are filled, nothing overwritten; the source stays ARCHIVED with `mergedIntoId`; an append-only `EntityMerge` (DB trigger) keeps the source snapshot and every moved id; merge-chains stay one hop; both rows locked `FOR UPDATE` in a stable order
- [x] Every change audited + domain event in the same transaction (CompanyArchived/Restored, PersonUpdated, EmploymentEnded, ContactPointUpdated/Archived, DuplicateCandidateDetected/Rejected, CompaniesMerged); Activity timeline built from the audit trail of the company and everything attached to it
- [x] API `/api/v1/companies…`, `/people…`, `/employments…`, `/contact-points…`, `/facts/:id/resolve`, `/duplicates…`; permissions `company.read` / `company.update` / `evidence.manage` / new `company.merge` (owner, admin, researcher); the overview returns `allowedActions`, the UI only shows those
- [x] Screens: Companies list, Company 360° (Overview, People, Intelligence, Evidence, Activity — Digital presence / Conversations / Opportunities / Memory shown with their phase; ICP / Opportunity / Intent shown as "Not scored", never faked), Duplicate review (side-by-side, why they match / what disagrees, keep left / keep right / not the same); works from 360 px without horizontal scroll
- [x] Tests: scoring unit tests (shared) + integration tests (detection, safe auto-merge, manual merge history, rejection, advisory lock, archive/restore, contact points, the six questions, HTTP role checks)
- Deferred by plan: research-driven company fields, website, digital presence and scores (Phase 8–9), person-level entity resolution and Prospect 360 intelligence (Phase 8), company notes (Phase 14 with memory), bulk import (Phase 22), re-pointing ExternalActions on merge (none reference companies before Phase 10)

## Phase 7 — Definition of Done
- [x] Schema: Market (one per place + industry via `marketKey`), DiscoveryMission (mode, budgets, docs/09 §16 state machine incl. PAUSED/WAITING/BLOCKED, counters, coverage, stop reason, worker lease), DiscoveryQuery (strategy × source, never repeated in a mission, cursor/pages persisted), DiscoveryObservation (raw provider record, unique per mission + provider + record id), CoverageAssessment (per round)
- [x] `packages/domain` (`@revenue-os/domain`): Nest-free domain logic shared by API and worker — context/audit, entity resolution, company create, merge, evidence/facts, discovery engine
- [x] Natural-language interpretation (deterministic, `@revenue-os/shared/discovery`): "Austin, Texas ke landscapers Market Exhaust mode mein find karo" → market + mode + website filter; the person confirms the structured form before anything runs
- [x] Quick / Deep / Market Exhaust profiles with real budgets (rounds, queries, provider calls, pages); industry taxonomy with related categories the user can toggle; query families: main category, related categories, keyword and geo variations
- [x] Pipeline Mission → query planning → provider search (through the Provider Gateway, pinned per source) → observation → normalization → entity resolution (HIGH = attach, MEDIUM/LOW = new company + review candidate) → Company → Evidence (provider + observed_at) + facts (website/phone/address/category; disagreeing sources become CONFLICTED) + provider mappings
- [x] Market Exhaust loop: one bounded round per job (event-chained via the outbox), marginal-yield measurement, stops on saturation / strategies exhausted / round limit / budgets / person; resumable after a crash (lease + sweep every minute); rate limits → WAITING with retry time; no source → BLOCKED
- [x] Coverage shown honestly: sources searched, queries executed, raw listings, unique businesses, duplicate rate, per-round yield, coverage confidence LOW/MEDIUM/HIGH with reasons — HIGH needs measured saturation over ≥3 rounds, ≥2 sources and ≥2 query families; never "100% found"
- [x] Second fake source (`fake_directory`) over the same fictional market as `fake_leads` — different formats, ids, coverage and result caps, occasional old phone number — so cross-source dedupe and saturation are real
- [x] API `/api/v1/discovery-missions` (preview, start 202, list, detail with allowedActions, companies with filters, pause/resume/stop with optimistic concurrency) and `/markets`; `market.read` / `market.run`; every command audited + event in the same transaction; one active mission per market (409 `MISSION_ALREADY_RUNNING`)
- [x] Screens: Lead Hunter (describe → understood as → editable market, categories, depth, sources with health, recent hunts, saved markets) and live hunt view (counters, per-round saturation bars, coverage card, activity feed, results table with website/phone/outcome filters → Company 360); no fake enrichment options
- [x] Tests: discovery unit tests (interpretation, planning, coverage), fake source tests, engine integration (Market Exhaust Austin landscaping on 2 sources → 72 → 11 → 5 → 0 new, SATURATED, HIGH; existing company matched not duplicated; BLOCKED; WAITING → resume; pause wins; QUICK; re-run creates no new companies), API integration + HTTP role checks
- Deferred by plan: enrichment (website/social/owners/verification, Phase 8) — state ENRICHING is skipped; SSE live updates (Phase 20, the hunt page polls); radius/ZIP/multi-city territories and map drawing; saved-market monitoring and change detection (Phase 15); AI interpreter (Phase 9, must produce the same structured shape); paid-call budget reservation (first paid lead vendor)

## Notes / known gaps
- `apps/web` screens abhi static placeholders hain (kuch mein dummy numbers). Roadmap §2: real data aane tak fake metrics nahi — har screen apne phase mein real banegi.
- `packages/policy`, `ai` khaali hain — apne phase mein bharenge.
- Dev seed adds new permissions to existing workspaces — after pulling a phase that adds permissions, run `pnpm db:seed` again.
