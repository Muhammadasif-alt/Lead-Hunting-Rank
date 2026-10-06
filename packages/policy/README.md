# @revenue-os/policy

Deterministic Policy Engine (Phase 10, docs/10 + docs/17 §62-66). AI proposes; this decides: **ACT / ASK / WAIT / BLOCK**.

- `evaluate(request, context)` — pure, no I/O, no LLM. Precedence: default deny → workspace → kill switch → suppression →
  permission / agent authority → pause → autonomy + approval → send window, daily limit, cool-down, provider.
- `requestExternalAction` — the one way to ask for a side effect: prepare → decide → queue / approval / wait / block.
- `createPolicyRevalidator` — the worker decides again right before every provider call.
- `decideApproval`, `policySweep`, `setOutboundState`, `updatePolicy`, `addSuppression`, `liftSuppression`, `simulatePolicy`.

`pnpm --filter @revenue-os/policy test` runs the engine tests (Definition of Done cases); the database cases live in
`apps/api/src/modules/policy/phase10.policy.integration.test.ts`.
