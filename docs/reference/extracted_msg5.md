Theek hai. Ab hum **18/18 screens ko freeze** samajh kar next phase **Master Technical Specification** start karte hain. Is phase mein bhi abhi code nahi likhenge.

Main isko is exact order mein lock karunga:

**Phase 1 — System Architecture**  
Next.js frontend, NestJS API, Worker, PostgreSQL, Redis/BullMQ, AI layer, provider adapters aur in sab ke darmiyan exact communication boundaries.

**Phase 2 — Database / Master Data Model**  
Company, Person, Market, Evidence, Contact Point, Campaign, Conversation, Message, Signal, Opportunity, Meeting, Memory, Knowledge, Task, Approval, Experiment, Policy, Audit, Event etc. ke exact relationships.

**Phase 3 — Event Architecture**  
Jaise `company.discovered → company.resolved → research.completed → prospect.scored → email.sent → reply.received → meeting.booked → opportunity.won`. Ye poore autonomous system ki backbone hogi.

**Phase 4 — AI Agent Architecture**  
Market Hunter, Research, Contact, Signal, Campaign, Conversation, Qualification, Scheduling, Learning aur AI Sales Manager agents; kis agent ko kya context/tools/authority milegi.

**Phase 5 — Workflow + State Machines**  
Lead se customer tak har state transition, retry, pause, cancellation, human takeover aur resume behavior.

**Phase 6 — Policy & Permission Engine**  
Screen #16 + #17 ko actual backend rules mein convert karenge: `ACT / ASK / WAIT / BLOCK`, RBAC, authority limits, confidence, grounding, suppression aur approval logic.

**Phase 7 — Queue / Worker Architecture**  
Discovery, enrichment, verification, AI processing, email, signals, calendar, analytics jobs; priority queues, retry, dead-letter, idempotency aur concurrency.

**Phase 8 — Provider Architecture**  
`EmailProvider`, `CalendarProvider`, `LeadProvider`, `EnrichmentProvider`, `VerificationProvider`, `LLMProvider`, `NotificationProvider`, `StorageProvider` ke exact contracts.

**Phase 9 — Memory + Knowledge Architecture**  
AI Memory aur Business Brain technically separate kaise rahenge; structured facts, vector retrieval, provenance, freshness, conflicts aur context builder.

**Phase 10 — API Architecture**  
Frontend ↔ Backend endpoints, commands, queries, streaming/live updates, webhooks aur internal service boundaries.

**Phase 11 — Security + Reliability**  
Authentication, authorization, encryption, secret management, audit, backups, rate limits, duplicate-send prevention, kill switch aur disaster recovery.

**Phase 12 — Deployment Architecture**  
Initially one VPS + Docker Compose, web/api/worker/Postgres/Redis/storage/reverse proxy/backups/monitoring. Scale hone par kis component ko pehle separate karna hai wo bhi define hoga.

**Phase 13 — Implementation Roadmap**  
Actual coding order. Hum 18 screens ko ek saath code nahi karenge; foundation → core entities → Lead Hunter → AI → outreach → inbox → sales → intelligence sequence mein controlled builds honge.

### Sabse pehle ab Technical Spec #1

**System Architecture** se start karna hai.

Target architecture roughly:

```text
                     WEB APP
              Next.js + TypeScript
                       │
                       ▼
                 NESTJS API
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
  PostgreSQL         Redis        Object Storage
  Source of Truth   Cache/Queue    Files/Snapshots
                       │
                       ▼
                  BULLMQ WORKERS
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
  AI / Agents     Data Providers    External Actions
                       │
              ┌────────┼─────────┐
              ▼        ▼         ▼
            Gmail   Calendar   Lead/Data
```

Lekin actual architecture is se kaafi deeper hogi—especially **Event Bus, Policy Engine, Context Builder, Agent Runtime, Evidence Layer aur Provider Gateway**.

**Ab next step mein main Technical Specification #1 — Complete System Architecture ko layer-by-layer banaunga aur lock karunga.**