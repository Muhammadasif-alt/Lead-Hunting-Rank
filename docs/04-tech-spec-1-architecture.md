# Technical Specification #1 — Complete System Architecture (LOCKED)

## 1. Architecture Style
Modular Monolith + Background Workers. No microservices now.
```
NEXT.JS WEB APP (18 screens) → HTTPS → NESTJS API (Auth/CRM/Markets/Campaigns/Inbox/Sales/KB/Memory/Policy/Analytics)
API → PostgreSQL (source of truth) + Redis (cache/locks)
Redis → BullMQ Queues → WORKER APP (Discovery/Research/AI/Email/Signals/Enrichment/Verify/Meetings/Analytics)
Worker → PROVIDER GATEWAY → Gmail/Calendar/Lead-Data/AI-LLM
```

## 2. Monorepo
```
revenue-os/
├─ apps/ { web, api, worker }
├─ packages/ { database, shared, ai, providers, policy, events, config }
├─ infrastructure/
└─ docs/
```

## 3. Web
Next.js + TypeScript. 18 screens, forms, tables, charts, command UI, live activity, notifications, approvals. Business authority not in browser.

## 4. API
NestJS. Async business layer. Example: Start Market Hunt → auth → permission → validate mission → create hunt → queue job → return Mission ID. Heavy work not held open in HTTP.

## 5. Worker
Same codebase/packages, background jobs. Discovery, deep research, enrichment, verification, website audit, signals, email sending, FU scheduling, inbound, AI, meeting prep, analytics, KB/memory processing.

## 6. PostgreSQL = Source of Truth
Companies/People/Markets/Campaigns/Messages/Conversations/Opportunities/Meetings/Signals/Memory/Knowledge/Policies/Tasks/Approvals/Experiments/Audit/Events. Redis/vector/LLM output never primary truth.

## 7. Redis
BullMQ, short-lived cache, distributed locks, rate limits, temp state, concurrency control. Wipe = no permanent data loss.

## 8. BullMQ
API → JOB → QUEUE → WORKER → RESULT → DATABASE → EVENT. Example: Research GreenScape → research.high → Research Worker → website+provider → normalized evidence → PostgreSQL → company.research.completed.

## 9. Queue Families
discovery / research / enrichment / verification / ai / email / conversation / signals / calendar / meetings / analytics / knowledge / memory / maintenance.

## 10. Queue Priorities
CRITICAL/HIGH/NORMAL/BACKGROUND. Incoming reply = HIGH. 3-month-old cold refresh = BACKGROUND. Active sales > background research.

## 11. Modular Backend
NestJS modules: AuthModule/UsersModule/WorkspaceModule/MarketModule/CompanyModule/PeopleModule/EvidenceModule/ResearchModule/EnrichmentModule/SignalModule/CampaignModule/ConversationModule/MessageModule/OpportunityModule/MeetingModule/TaskModule/MemoryModule/KnowledgeModule/PolicyModule/ApprovalModule/ExperimentModule/AnalyticsModule/IntegrationModule/NotificationModule/AuditModule/EventModule. Logical boundaries, not microservices.

## 12. Company Is Central Entity
COMPANY → People/Signals/Digital Data → Conversations → Opportunities → Meetings.

## 13. Person Separate
PERSON + EMPLOYMENT (John → GreenScape → Owner). John joins ABC → previous survives. No person JSON inside company row.

## 14. Evidence Layer
FACT + EVIDENCE (source, confidence). Important facts evidence-backed.

## 15. Facts/Signals/Inferences
FACT observable, SIGNAL event/change, INFERENCE AI interpretation. AI won't present inference as fact.

## 16. Canonical Data Model
Company/Person/Employment/ContactPoint/Evidence/Market/Signal/Campaign/Enrollment/Conversation/Message/Opportunity/Meeting/Memory/Knowledge/Task/Approval/Experiment/Policy/Event/Audit. Vendor fields never contaminate core.

## 17. Provider Gateway
Business logic → Provider interface → Adapter → External API. GmailAdapter now, OutlookAdapter future, unchanged business logic.

## 18. Provider Interfaces
EmailProvider/CalendarProvider/LeadProvider/EnrichmentProvider/VerificationProvider/LLMProvider/StorageProvider/NotificationProvider.

## 19. Lead Discovery Architecture
Market Mission → Query Planner → Source Router → Lead Providers → Raw Results → Normalization → Entity Resolution → Deduplication → Company Records → Evidence → Coverage Engine. Market Exhaust not single search.

## 20. Market Exhaust Loop
Generate queries → search → normalize → resolve → count new uniques → next strategy → search again → measure marginal yield. Stop: exhausted / low yield / budget / round limit / human stop.

## 21. Entity Resolution
Signals: normalized name/domain/phone/address/coords/social/people. HIGH → auto merge. Medium/low → human review (DUPLICATE CANDIDATE). No blind merge.

## 22. Event Architecture
company.discovered/resolved/enriched/researched, contact.discovered/verified, campaign.enrolled, message.sent, reply.received, conversation.classified, meeting.requested/booked, opportunity.created/won.

## 23. Event ≠ Command
Command: SendEmail = kuch karna. Event: EmailSent = kuch ho gaya. No mix.

## 24. Event Flow Example
Gmail → inbound message → normalize → save → message.received → conversation worker → identity resolution → cancel pending follow-ups → classification → memory extraction → qualification update → policy decision → AI reply/human/wait.

## 25. Transactional Outbox
DB transaction updates entity + creates outbox event, then COMMIT. Worker publishes/processes outbox. Fixes DB update but event publish failed.

## 26. Idempotency
Mandatory: email/calendar/webhooks/paid enrichment. Key: campaign_id+contact_id+step_id+message_version. Retry → existing completed action → return existing result. No duplicate send.

## 27. Side-Effect Boundary
INTERNAL: score/classify/summarize/memory update/recommendation. EXTERNAL: send email/book meeting/paid provider/webhook. External get stronger idempotency/audit/policy.

## 28. Policy Engine
AI proposes action → ACTION REQUEST → POLICY ENGINE → ACT/ASK/WAIT/BLOCK. Only ACT reaches execution.

## 29. Policy Inputs
Actor/Action/Company/Person/Campaign/Conversation/Opportunity/Autonomy level/Confidence/Evidence/Suppression/Relationship state/Budget/Provider health/Permissions. Deterministic where possible.

## 30. AI Is Not Authorization Engine
LLM doesn't decide discounts. Policy engine decides authority. AI understands; policy authorizes.

## 31. Agent Runtime
AI Sales Manager orchestrates Market Hunter/Research/Contact/Signal/Campaign/Conversation/Qualification/Scheduling/Learning. Not 10 permanent processes; agent definition+task+context+tools+policy+structured output; worker executes.

## 32. Agent Context
Agent doesn't get whole DB dump. Context builder: task → required entities → current facts → memory → KB → policies → recent events → compact context.

## 33. Context Builder Example
Conversation Agent: incoming message + person + company + current conversation + previous summary + active opportunity + qualification + commitments + relevant memory + KB + pricing rules + AI authority. Not entire DB/KB/every email.

## 34. Structured AI Outputs
incent/confidence/questions/facts_extracted/recommended_action/draft/requires_human/reason_codes. Schema-validated before use.

## 35. AI Tool Access
Research Agent: search approved sources/fetch company page/query enrichment/save candidate evidence. Conversation Agent: retrieve context/draft reply/check KB/propose qualification update/propose meeting. No delete DB/change policy/export all contacts.

## 36-37. Memory/Knowledge Architecture
Memory: raw event → extraction → candidate memory → entity resolution → conflict/freshness check → structured memory. Knowledge: internal source → ingest → parse → structure → review → approve → version → publish. Only approved/current/scope-appropriate KB grounds autonomous claims.

## 38. Structured + Semantic Retrieval
Critical (price/integrations/policy/eligibility) = structured records. Long-form (case studies/guides/FAQ) = semantic/vector. Hybrid.

## 39. Vector Store
Initially PostgreSQL + pgvector. Separate vector DB only if scale demands.

## 40. Conversation Architecture
Account → Conversation → Messages (direction/channel/sender/recipient/provider IDs/timestamp/content/thread/classification). Provider IDs for dedupe/threading.

## 41. Campaign vs Conversation Boundary
Before reply: Campaign engine owns sequence. After genuine reply: campaign FU STOP, conversation engine owns. Enforced in architecture, not UI convention.

## 42. Opportunity Architecture
Company/primary contact/stakeholders/source/campaign/original signal/conversations/meetings/proposal/stage/qualification/commitments/revenue. Company ≠ Opportunity.

## 43. Meeting Architecture
Provider event ID/company/opportunity/attendees/type/owner/start-end/timezone/status/brief/notes/outcome/commitments. Calendar event not whole meeting.

## 44. Signal Architecture
Raw observation → normalize → change detection → dedupe → signal → relevance → opportunity hypothesis. Raw observation stored separately from interpreted signal.

## 45. Analytics Architecture
Operational DB = events+transactional. Analytics jobs → aggregations/projections → dashboard queries. PostgreSQL enough initially; no data warehouse.

## 46. Revenue Attribution
Store during lifecycle: company→discovery source→market→signal→campaign→message→conversation→meeting→opportunity→revenue. Screen #10 answers where revenue came from.

## 47. Audit Architecture
actor_type/actor_id/action/entity_type/entity_id/before/after/policy_version/timestamp/correlation_id. AI and humans both actors.

## 48. Correlation ID
Incoming reply triggers 12 ops; one correlation ID links message.received→classification→memory→qualification→FU cancellation→reply gen→policy→send.

## 49. Live UI Updates
SSE initially for server→browser. WebSockets only where bidirectional realtime needed.

## 50. API Pattern
/api/companies /markets /campaigns /conversations /opportunities /meetings /signals /analytics /ai /settings. Explicit commands: POST /campaigns/:id/launch /conversations/:id/takeover /opportunities/:id/approve-proposal. Not generic CRUD for everything.

## 51. Authentication
User/Session/Workspace/Role/Permissions. Every request resolves WHO/WHICH WORKSPACE/WHAT PERMISSION/WHAT SCOPE before action.

## 52. Workspace Isolation
workspace_id on every major business entity. Not multi-tenant SaaS UI now, but ownership explicit.

## 53. Security Boundaries
Browser never gets provider secrets/DB credentials/OAuth refresh tokens/LLM keys. External provider access server-side.

## 54. Secret Architecture
Encrypted credentials, environment secrets, OAuth token encryption, redacted logs. Deployment spec locks implementation later.

## 55. External Input = Untrusted
Email/website/provider/webhook/CSV/AI output: validate → normalize → authorize → sanitize/classify → business processing.

## 56. AI Prompt-Injection Boundary
Website/email content is data not instructions. Tools+permissions live outside retrieved content.

## 57. Reliability Model
Every job: can retry? idempotent? external side effect? max attempts? backoff? dead-letter?

## 58. Retry Classification
NETWORK TIMEOUT retry / RATE LIMIT delay / PROVIDER 500 retry / AUTH FAILURE pause integration / INVALID REQUEST don't retry blindly / POLICY BLOCK don't retry / SUPPRESSION never retry send.

## 59. Circuit Breaker
Provider failures → circuit open → stop requests → health probe → recover.

## 60. Kill Switch Architecture
STOP ALL OUTBOUND not only UI. Execution layer checks global outbound state before external side effect: Email job → global outbound check → policy → idempotency → provider. Queued emails blocked.

## 61. Resume Architecture
On resume, don't release old queue blindly. Revalidate: reply? unsub? company changed? campaign active? email valid? opportunity changed? → regenerate eligibility.

## 62. File/Object Storage
KB docs, attachments, website snapshots, exports, meeting files. DB stores metadata/reference, not giant blobs.

## 63. Website Snapshots
Snapshot N → compare → snapshot N+1 → meaningful change? Retention policies.

## 64. Observability
LOGS (what happened), METRICS (how system behaves), TRACES/CORRELATION (one operation through system). Lightweight initially, prepared for all three.

## 65. Failure Isolation
AI provider down → CRM+inbox+historical analytics work. Lead provider down → existing sales work continues. Calendar down → don't invent availability. One failure ≠ whole OS down.

## 66. Deployment Topology Initial
One VPS with Docker Compose: reverse proxy/Next.js web/NestJS API/worker/PostgreSQL/Redis/supporting services.

## 67. Backup Must Leave VPS
VPS failure shouldn't destroy DB+backups. Backup destination independent.

## 68. Scaling Path
More worker replicas → separate DB host → separate Redis → separate worker machines → managed object storage → later specific service extraction.

## 69. Why Not Microservices Now?
Network complexity/distributed transactions/deployment/observability/failure modes/DevOps without benefit at 4–5 users.

## 70. Master Runtime Flow
USER GOAL → AI SALES MANAGER → MISSION PLAN → POLICY/BUDGET → MARKET HUNTER → COMPANIES → ENTITY RESOLUTION → RESEARCH+ENRICHMENT → EVIDENCE → SCORING → OPPORTUNITY HYPOTHESIS → CAMPAIGN → PRE-SEND POLICY → EMAIL → REPLY → CONVERSATION ENGINE → MEMORY+QUALIFICATION → MEETING → OPPORTUNITY → PROPOSAL → WON/LOST → REVENUE ATTRIBUTION → ANALYTICS → LEARNING → EXPERIMENT → APPROVED STRATEGY IMPROVEMENT ↺

## 7 Foundational Decisions (LOCKED)
1. Next.js + NestJS + TypeScript
2. Modular Monolith, no microservices
3. PostgreSQL source of truth; Redis/BullMQ async infra
4. Company-first canonical data model + evidence/provenance layer
5. Event-driven workflows + transactional outbox + idempotency
6. AI proposes/reasons; deterministic Policy Engine decides authority
7. External providers behind adapter interfaces

## Next Step
Technical Specification #2 — Master Database & Data Model.
