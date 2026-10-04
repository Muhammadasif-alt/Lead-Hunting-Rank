# @revenue-os/providers

Provider Gateway (Phase 5, `docs/12-tech-spec-8-provider-architecture.md`). Domain code asks for a **capability**; the
gateway picks an adapter from the workspace's integrations and owns everything around the call.

```
Domain / worker → ProviderGateway.call({ capability }) → router → circuit breaker → rate limiter → adapter → vendor
                                                        ↘ usage (ProviderCallRecord) + health (per capability)
```

| Path | What |
|---|---|
| `src/core/` | capabilities, normalized error taxonomy, typed capability interfaces |
| `src/catalog.ts` | provider registry (browser-safe via `@revenue-os/providers/catalog`) |
| `src/gateway/` | `ProviderGateway`, limiter + circuit state (memory / Redis) |
| `src/fakes/` | fake Email, Calendar, Lead, Verification, LLM, Notification providers + failure injection |
| `src/storage/local.ts` | real local-disk storage |
| `src/executors/email-send.ts` | `email.send` ExternalAction executor |
| `src/runtime/` | Prisma usage/health sinks, integration router, `createProviderRuntime()` used by API + worker |

Rules: no vendor SDK outside an adapter; adapters throw `ProviderCallError(kind)`; the gateway never retries (queues do);
a side effect with an unclear outcome is reconciled, never resent or sent through another provider; unknown cost stays
unknown. Add a real vendor by implementing its interface, registering it in `catalog.ts` and `runtime/adapters.ts`.
