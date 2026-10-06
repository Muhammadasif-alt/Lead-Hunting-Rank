# @revenue-os/ai

AI runtime (Phase 9, docs/08 + docs/17 §58-61): agent registry and typed tools, prompt registry, context builder,
AI gateway, deterministic validators, and the company agents (Research, Website Audit, Contact, Scoring).

Agents only read and propose — no external messages, meetings, pricing or strategy changes.

- `pnpm --filter @revenue-os/ai test` — evaluation harness + red-team checks with the test model
- `pnpm --filter @revenue-os/ai eval` — the same harness; uses Claude when `LLM_PROVIDER=anthropic` and `LLM_API_KEY` are set
