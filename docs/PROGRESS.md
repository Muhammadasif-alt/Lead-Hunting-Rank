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
| 4 | Events + Outbox + Queue | ⬜ |
| 5 | Provider Gateway (fake providers first) | ⬜ |
| 6 | CRM Core — Company 360 | ⬜ |
| 7 | Lead Hunter — Market Exhaust | ⬜ |
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

## Notes / known gaps
- `apps/web` screens abhi static placeholders hain (kuch mein dummy numbers). Roadmap §2: real data aane tak fake metrics nahi — har screen apne phase mein real banegi.
- `packages/events`, `policy`, `providers`, `ai` khaali hain — apne phase mein bharenge.
