# @revenue-os/events

Event + queue infrastructure (Phase 4 — `docs/07-tech-spec-3-event-architecture.md`, `docs/11-tech-spec-7-queue-workers.md`).

| Import | What |
|---|---|
| `@revenue-os/events` | Event registry, `recordEvent(tx, …)` outbox writer, `dispatchOutboxBatch`, ExternalAction state machine (`prepareExternalAction`, `queueExternalAction`, `executeExternalAction`, `expireStaleClaims`), `processOnce` (inbox receipts), dead letters |
| `@revenue-os/events/runtime` | BullMQ pieces: `createQueueWorker` (shared wrapper), `QueueProducer`, `startOutboxLoop`, heartbeats/metrics, external-action job handlers |
| `@revenue-os/events/testing` | `FakeSideEffectProvider` (no built-in dedupe, failure injection) |

Rules
- Emit events with `recordEvent` **inside the same transaction** as the change. New event → add it to `registry.ts` (past-tense name, minimal payload, version).
- Never call a provider from a service: prepare an ExternalAction with an idempotency key and queue it; the worker executes it once.
- Consumers must be idempotent (at-least-once delivery). Use `processOnce` for internal effects.
