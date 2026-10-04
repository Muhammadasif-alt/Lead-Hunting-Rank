# ⚠️ READ FIRST — Instructions for Any AI Tool

This file is the entry point for Claude, Copilot, OpenCode, or any AI working on this repo.

## Before doing anything
1. Read `docs/PROGRESS.md` — which build phase we're in and what's next.
2. Read `docs/00-vision.md` and `docs/02-master-specification-v1.md` — what the product is.
3. Read `docs/17-tech-spec-13-implementation-roadmap.md` — the locked build order (Phase 0 → 24) and coding rules.
4. For the phase/screen you're working on, read its tech spec (`docs/04`–`docs/16`) and screen spec (`docs/screens/`).
5. `README.md` explains setup, commands and folder layout.

## Current state
- Specification phase is **complete and locked**. We are now **coding**, phase by phase, in roadmap order.
- Don't skip ahead (e.g. no AI Sales Manager before agents exist, no email sending before suppression + idempotency, no fake dashboards).
- When a phase's Definition of Done is met, update `docs/PROGRESS.md`.

## Architecture rules (locked)
- Stack: Next.js (`apps/web`) + NestJS (`apps/api`) + BullMQ worker (`apps/worker`) + PostgreSQL/Prisma (`packages/database`) + Redis. pnpm monorepo, TypeScript, ESM.
- Modular monolith. No microservices / Kafka / Kubernetes.
- Company is the canonical entity. Facts need evidence + source + observed_at. Facts vs AI inference stay separate. No blind auto-merge.
- AI proposes; deterministic Policy Engine decides (ACT / ASK / WAIT / BLOCK). LLM output never writes straight to the DB.
- Every external side effect goes through ExternalAction + idempotency + policy + kill switch.
- Controllers never touch Prisma directly — application services do.
- Every API route is authenticated by default (global guards). Mark only login/health-type routes `@Public()`; protect actions with `@RequirePermission('…')` and authority checks via `AccessService`. Services take a `ServiceContext` (workspace + actor) built from the session — never a workspaceId/userId from the request body.
- Config only via `loadConfig()` from `@revenue-os/config`; queue names only from `@revenue-os/shared`.
- Not a GHL clone. Mental model: Goal → Intelligence → Decision → Action → Outcome → Learning.

## Process rules
- When the user pastes a spec ("aisa spec aapko diya"), save it into the appropriate `docs/` file immediately.
- Run `pnpm typecheck` before saying work is done; check `/diagnostics` when touching infra.
- Next.js in this repo is a newer version than most training data — read `apps/web/AGENTS.md` before writing web code.
- Web UI: use the design tokens/classes in `apps/web/src/app/globals.css` (`bg-surface`, `text-muted`, `.card`, `.btn-primary`…). App screens live in `src/app/(app)/` and are registered in `src/lib/screens.ts`. A screen shows an honest placeholder until its phase is built — no fake metrics. Each area has a colour tone (`tone` in `screens.ts`: leads/email/sales/ai/insight/system) — new screens must pick the right one. When a phase completes, update `docs/PROGRESS.md` and `apps/web/src/lib/roadmap.ts`.
