# Technical Specification #3 — Event Architecture & Workflow Engine (LOCKED)

## 1. Core Principle
No giant synchronous chain. ACTION → DB transaction → DOMAIN EVENT → OUTBOX → EVENT DISPATCHER → relevant workers → new events. One event fans out to independent workflows.

## 2. Commands vs Events — LOCK
Command = request (DiscoverCompanies, ResearchCompany, VerifyContact, EnrollProspect, SendEmail, ClassifyReply, BookMeeting, CreateOpportunity) — can fail/reject/block. Event = past-tense immutable fact (CompanyDiscovered, CompanyResearched, ContactVerified, ProspectEnrolled, EmailSent, ReplyReceived, MeetingBooked, OpportunityCreated/Won).

## 3. Event Envelope
event_id, event_type, event_version, workspace_id, entity_type, entity_id, actor_type, actor_id, correlation_id, causation_id, occurred_at, payload, metadata.

## 4. Correlation vs Causation
One business flow (ReplyReceived→SequenceCancelled→ReplyClassified→QualificationUpdated→AIReplyProposed→EmailSent) shares correlation_id; each event points to immediate predecessor via causation_id. Full causal tree reconstructable.

## 5. Transactional Outbox
BEGIN TRANSACTION → UPDATE opportunity → INSERT outbox_event → COMMIT. Both succeed together. Bad: UPDATE→COMMIT→publish event→crash.

## 6. Outbox Dispatcher
Find pending → claim batch → dispatch handlers/jobs → mark published. Crash → event remains pending/retryable.

## 7. Delivery Guarantee
At-least-once. Never exactly-once fantasy. Every important handler must be idempotent.

## 8. Inbox Pattern
Provider Webhook → verify signature/auth → persist InboundEvent → acknowledge → async processing. Unique external identity dedupes; webhook endpoint does minimal work.

## 9. Raw Inbound First
RAW PROVIDER EVENT → persist → normalize → resolve entity → domain event. Enables investigating provider bugs and safe reprocessing.

## 10-12. Event Categories + Ownership + Communication Rule
ENTITY/INTELLIGENCE/OUTREACH/CONVERSATION/SALES/CONTROL/SYSTEM events. Module owns its events. No cross-module table mutation (Campaign should not directly edit Opportunity tables; send command to owning domain).

## 13. Synchronous vs Asynchronous
Sync for user-facing deterministic results (Open Company, Save Note, field change, fetch pipeline). Async for Market Exhaust, Research, Enrichment, AI, Email, Signals, Analytics, Website audits, Embeddings.

## 14-15. Command + External Action Lifecycle
REQUEST→AuthN→AuthZ→Validate→Business Rules→Transaction(mutation+outbox)→COMMIT→Response. SendEmail: resolve context→permission/agent authority→hard suppression→account conflict→contact validity→evidence/freshness→campaign eligibility→policy→budget/rate limit→provider health→ACT/ASK/WAIT/BLOCK.

## 16-17. ExternalAction + Double Policy Check
Record PREPARED→QUEUED→EXECUTING→SUCCEEDED/BLOCKED/FAILED/CANCELLED with idempotency_key. Policy evaluated (1) when proposed AND (2) immediately before execution — prospect may have unsubscribed, human may have paused, opportunity may have opened, mailbox may have degraded, policy may have changed, contact may have replied. Old approval/decision never overrides current hard safety state.

## 18. Email Send Flow
Campaign determines email due → SendEmail proposed → load company/person/conversation → suppression → account protection → contact verification → campaign eligibility → message grounding → policy → approval if required → ExternalAction PREPARED → email.send queue → Worker → revalidate everything material → idempotency → rate limit → provider health → EmailProvider.send() → store provider message ID → ExternalAction SUCCEEDED → Message SENT → EmailSent → timeline/analytics/sequence scheduling. Only safe pattern.

## 19-22. Genuine Reply Flow
Gmail webhook/sync → InboundEvent persisted → normalize → provider message dedupe → resolve sender/company/conversation → store Message → ReplyReceived → IMMEDIATELY CANCEL PENDING COLD FOLLOW-UPS → context builder → classification → intent extraction → fact candidates → commitment detection → qualification extraction → opportunity relevance → Next Best Action → policy → AUTO_REPLY/DRAFT_FOR_HUMAN/CREATE_APPROVAL/CREATE_TASK/BOOKING_FLOW/WAIT/CLOSE/SUPPRESS.

## 20. Why Sequence Stops First
Reply arrives (yes interested, talk tomorrow) but classification takes 20s; follow-up timer due → bad. Therefore genuine inbound reply immediately suspends cold sequence ownership, then classify. Exception: bounce/auto-response/delivery notice/security gateway identified during normalization.

## 23-25. Unsubscribe/Wrong Person/Not Now
Unsubscribe detected → Create/Update Suppression → cancel future sends → remove/stop enrollment → conversation state update → audit → UnsubscribeProcessed. AI cannot decide to follow up anyway. Hard rule wins. Wrong person/referral: store source, candidate person, relationship evidence, research/resolve, policy decides outreach, no fabricated emails. Not Now: extract date/window → memory → commitment/follow-up state → pause cold sequence → schedule future eligibility check → at date: revalidate company/person/contact/policy → determine current Next Best Action, never blindly resend old template.

## 26-28. Meeting Request Flow + MeetingBooked
Reply→MEETING_REQUEST→scheduling intent→qualification requirement check→scheduling policy→calendar health→fetch REAL availability→offer slots. On selection: recheck slot→book idempotently→meeting record→calendar event→MeetingBooked. Calendar event failure → don't invent slots, escalate.

## 29-32. Opportunity Flows
Positive reply alone ≠ opportunity. Conversation→commercial need evidence→qualification/opportunity criteria→CreateOpportunity→domain validation→OpportunityCreated; else ENGAGED. Stage change: ChangeOpportunityStage→validate transition→check required fields→transaction(opportunity update+StageHistory+outbox)→OpportunityStageChanged. Won: OpportunityWon→Revenue Event→Attribution update→stop prospecting→company lifecycle update→analytics→learning candidates. Lost: structured reason→stop deal automation→nurture eligibility→analytics→negative learning candidate (proposed, not instant global strategy).

## 33-37. Lead Discovery + Market Exhaust + Entity Resolution
StartDiscoveryMission→MissionCreated→Planner creates queries→provider jobs→raw observations→normalize→entity resolution→Company create/update→Evidence→CompanyDiscovered/CompanyUpdated→enrichment eligibility. Market Exhaust rounds with marginal yield analysis; continue if unexplored strategies + new unique yield + coverage + budget + provider health + limits + no human pause. State machine: DRAFT→PLANNING→DISCOVERING→RESOLVING→ENRICHING→ASSESSING_COVERAGE→(MORE→NEXT ROUND | ENOUGH→COMPLETE) | PAUSED/BLOCKED/FAILED/CANCELLED. Entity resolution: normalize identity→find candidates→compare name/domain/phone/address/coords/profiles→HIGH=attach to existing/MEDIUM=duplicate candidate review/LOW=create new. Merge: request→lock entities→re-evaluate duplicates→check conflicting active relationships→transaction(repoint references, preserve source as merged, EntityMerge)→CompanyMerged event. Never delete evidence history.

## 38-39. Research Workflow + Cost-Aware
ResearchCompany→check freshness→determine missing info→select providers/tools→fetch observations→validate→Evidence→Fact Candidates→conflict detection→canonical updates→CompanyResearched. Gap-aware research, not fetch everything. Before expensive enrichment: freshness, priority, provider call necessary, budget available → else skip.

## 40-42. Website Audit + Signal Workflow
Official website resolution→fetch→snapshot→deterministic extraction→AI analysis where useful→structured findings→Evidence→Facts→Opportunity Hypothesis. Signal: source observation→compare previous state→meaningful change?→candidate→dedupe→evidence validation→SignalDetected→relevance→ACTIONABLE/MONITOR/DISMISS. Signal triggered outreach NEVER SignalDetected→SendEmail directly; must pass Relevance→Why Now→Relationship Check→Eligibility→Campaign/Strategy→Policy→External Action.

## 43-46. Campaign Launch + Cohorts + Enrollment + FU Scheduling
LaunchCampaign→config validation→audience validation→suppression→mailbox health→policy→budget→approval if required→CampaignStarted. Cohorts: don't queue 50k emails instantly; cohort 1→observe→guardrails→continue/pause/review→cohort 2. Enrollment before-check: company/person eligible, suppressed, existing opportunity, recent conversation, another campaign, frequency cap, verified contact → then CampaignEnrollmentCreated; eligibility re-checked before send. After EmailSent: sequence policy→potential next FU time→delayed job→when wakes: re-evaluate reply?/meeting?/opportunity?/suppression?/campaign active?/contact valid?/policy?→decide.

## 47-48. Scheduler + Delayed Jobs
Recurring: signal scans/market refresh/memory revalidation/knowledge staleness/daily analytics/morning brief/FU eligibility/provider health. Scheduler creates jobs/events, doesn't execute side effects. Delayed job "Follow up John at 10 AM" = reconsider whether appropriate, NOT definitely send.

## 49-52. Worker Classes + Priority + Starvation + Payload
REALTIME/HIGH PRIORITY (inbound replies, conversation, policy, calendar, urgent notifications). OUTBOUND (email sends, FUs, rate-limited actions). BACKGROUND (discovery, research, enrichment, website audits, signals, analytics, embeddings). Market Exhaust must not starve incoming sales reply. Queue priorities: P0 CRITICAL (unsubscribe/suppression, critical provider incident)/P1 HIGH (inbound reply, meeting booking, approval continuation)/P2 NORMAL (scheduled outreach, contact verification)/P3 BACKGROUND. Payload: IDs+intent, not giant stale snapshots; worker reloads current state.

## 53-57. Retry + Backoff + DLQ + Manual Retry + Idempotency Strategy
NETWORK→retry w/ backoff; 429→retry after provider delay; 5XX→limited retry; AUTH→integration degraded + stop retry storm; VALIDATION→permanent fail; POLICY BLOCK→blocked; SUPPRESSION→cancelled/blocked; BUDGET→wait/approval. Exponential backoff + jitter. DLQ with failure reason/attempts/last error/entity/correlation ID/provider; Screen #18 inspect/retry. Manual retry creates safe path + rechecks current state/idempotency/policy/eligibility. Idempotency: Email=campaign+enrollment+step+message_version; Meeting=conversation+slot+type; Enrichment=company+provider+operation+freshness_window; Webhook=provider+external_event_id. Persistent DB record for external side effects; Redis lock optional helper, DB proves historical execution.

## 58-61. Locks + Conversation Serialization + Optimistic Concurrency
Locks for narrow sections only: conversation processing, company merge, campaign enrollment, meeting booking, external action execution. No global locks. Per-conversation serialization for simultaneous replies. Optimistic concurrency via version field; stale update → reload/re-evaluate. Especially opportunity/conversation/campaign/policy.

## 62-66. Approval + Human Edit + AI Decision + Output Validation
AI Action Proposal→Policy=ASK→ApprovalRequest→Human reviews exact payload→APPROVED→ApprovalGranted→Continuation Job→Revalidate→Execute if still valid. Approval invalidates on material change (message/price/audience/recipient/offer/policy). Human edit: EDIT→new action version→re-evaluate policy→potential new approval. Agent: Context→Structured AI Output→Schema Validation→Evidence Validation→Domain Validation→Policy. LLM output never directly writes provider side effect. Malformed output schema fails → retry/repair or human.

## 67-71. Context Builder + Freshness + KB Retrieval + Memory Update + Commitment Workflow
Context Builder: Task→required context→permission/sensitivity filter→Company→Person→Relevant conversation→Opportunity→Memory→Knowledge→Policies→Evidence→Token/cost budget→Context Package. Before high-impact AI response: pricing current?/contact current?/opportunity state current?/latest reply included?/knowledge approved? → stale may force refresh/WAIT. KB retrieval: Question→structured lookup→relevant approved scope→semantic retrieval→effective date→conflict check→grounded context; no approved answer → KnowledgeGap + Human Attention, not hallucination. Memory update: Message→extraction candidates→classify fact/preference/commitment/relationship info/qualification→confidence/source→conflict check→memory mutation; high-impact uncertain memory may need review. Commitment: "I'll confirm Friday" → PROSPECT_PROMISED→due Friday→WAITING ON PROSPECT→CommitmentDue→Next Best Action. Human promise: "I'll send pricing tomorrow" → WE_PROMISED→owner→due tomorrow→AttentionItem nearing deadline.

## 72-73. Task + Attention Workflow
Task: TaskCreated→Assigned→OPEN→IN_PROGRESS→COMPLETED; alt WAITING/BLOCKED/CANCELLED. Completion may emit domain event. Attention: Issue detected→Can AI safely resolve? YES→resolve / NO→Does human need action now? NO→WAIT / YES→AttentionItem. Prevents task spam.

## 74-75. Provider Health Workflow + Gmail/Calendar/LLM/Redis/Postgres Failure
Periodic health check→Healthy? → IntegrationDegraded→policy awareness→affected workflows WAIT/BLOCK→incident if necessary→IntegrationRecovered→re-evaluate waiting jobs. Gmail unhealthy: new sends WAIT/BLOCK, but research/analytics/existing CRM continue; inbound webhook missed → sync job catches up via idempotency. Calendar unhealthy: no new auto-booking, don't invent slots, escalate. LLM unavailable: deterministic ops continue; AI-required ops WAIT/retry/human. Redis failure: async work pauses; API selected safe DB reads/writes; never bypass queues to send email. PostgreSQL failure: external autonomous side effects FAIL CLOSED.

## 76-80. Kill Switch + Resume + Replay Rule + Side-Effect Consumer Protection
PauseAllOutbound → transaction(workspace outbound=PAUSED+OutboundPaused event)→workers check durable state (Redis can cache, DB authority). Kill switch doesn't delete queue; on resume revalidate queued actions. Events replayable for analytics/search index/read model/debugging; replay never auto-resends external side effects. Replay EmailSent = rebuild internal state, NOT send again. Handlers with external side effects need explicit command+policy+ExternalAction+idempotency; never execute solely because historical event replayed.

## 81-85. Analytics + Attribution + Learning + Experiment + Notification
Domain events→analytics consumers→projection tables; analytics failure doesn't block core sales. Attribution consumer links touches incrementally. Learning: outcome events→analytics→pattern candidate→learning candidate→evidence→experiment/review→validated learning; never one lost deal→global strategy. Experiment: hypothesis→created→approval if needed→cohort assignment→execution→outcome events→metrics→guardrail check→complete/pause→learning candidate. Guardrail breach → pause treatment + human attention; learning engine can't override safety. Notification: domain event→notification policy (who/channel/urgency/quiet hours/already notified?)→notification; not every event becomes notification.

## 86-88. Command Center + SSE Security + Event Schema Versioning
Domain event→read model/projection update→realtime publisher→SSE→authorized browser. ReplyReceived updates conversation count/attention/live activity/hot prospect without refresh. Browser subscribes authenticated session; server scopes by workspace+user permissions+assignments; browser never subscribes directly to Redis. Event schema versioning: ReplyReceived v1; later payload → v2; don't silently change old interpretation; consumers declare supported versions/upcasting.

## 89-92. Event Payload Rule + Immutability + Ordering + Scheduled Event
Events carry enough to identify what happened; prefer IDs (conversation_id, message_id, received_at) not entire DB snapshots. MeetingBooked not edited; MeetingCancelled emitted as new event. Don't assume perfect global ordering; where ordering matters (Conversation/Opportunity/Campaign Enrollment) use entity version/sequence+DB state; tolerate out-of-order where possible. Scheduled triggers aren't facts until evaluated: FollowUpDue→evaluate follow-up now→Eligible?→actual send→EmailSent.

## 93-96. Cancellation/Obsolescence + Workflow State Persistence + Workflow Engine Decision
Long-running research task starts; company archived meanwhile; worker before saving final result checks still active/mission running/result relevant → discard safely or record observation. Important long-running workflow state lives in PostgreSQL (mission/campaign/conversation/approval/external action status) — not only in BullMQ. No Temporal/Camunda initially; our stack sufficient. If dramatic complexity later, dedicated durable workflow engine can be evaluated.

## 97-101. State Machine Validation + Conversation/Opportunity/Mission/Approval/ExternalAction States
Campaign: DRAFT→READY→ACTIVE→PAUSED→ACTIVE→COMPLETED; COMPLETED→DRAFT invalid unless explicit clone/reopen. Conversation: COLD→CONTACTED→REPLIED→ENGAGED→QUALIFYING→QUALIFIED→MEETING_REQUESTED→MEETING_BOOKED with exits NURTURE/CLOSED/SUPPRESSED/ESCALATED. Opportunity: NEW→CONTACTED→ENGAGED→QUALIFIED→MEETING→PROPOSAL→NEGOTIATION→WON or LOST/NURTURE. Mission: DRAFT→READY→RUNNING (WAITING/PAUSED/BLOCKED/COMPLETED/FAILED/CANCELLED) with reason for blocked/failed/cancelled. Approval: PENDING→APPROVED/REJECTED/EXPIRED/INVALIDATED/CANCELLED; terminal states not silently reopened; create new approval if needed. ExternalAction: PREPARED→APPROVED→QUEUED→EXECUTING→SUCCEEDED/WAITING/BLOCKED/FAILED/CANCELLED; SUCCEEDED never re-executes under same idempotency key.

## 102-104. Audit vs Event + Activity vs Event + Agent Workflow
Event=opportunity stage changed (system behavior); Audit=User X changed Opportunity Y from Qualified→Proposal at time Z (accountability/governance). Activity=human-readable timeline line. Some actions produce both; don't treat same table/concept. Agent workflow: AgentTaskCreated→worker claims→Context Builder→LLM/tool execution→structured result→validation→AIDecision→Domain Command→Policy→Outcome. Agent never mutates random tables.

## 105-107. AI Sales Manager + Replanning + Plan Versioning
Goal→Planner→Plan Version→Missions→Dependencies→Agent Tasks→Outcomes→Goal Evaluation→Replan if needed. Replanning: verification bottleneck→propose increase verification priority/reduce low-value research; high-impact budget/scope change→ASK. Plans versioned (v1 plan v2 with changed_at/reason/trigger) so user can ask "why did AI change the plan?".

## 108-110. Agent Tool Boundary + Provider Boundary + Provider Event Normalization
Agent typed capabilities: GetCompany/SearchKnowledge/ProposeFact/CreateResearchRequest/ProposeReply/CheckAvailability. NOT arbitrary SQL/HTTP/env secrets. Workers don't scatter gmail.users.messages.send through codebase; EmailProvider.send() adapter; same for CalendarProvider/LeadProvider/VerificationProvider/EnrichmentProvider/LLMProvider. Gmail/Outlook webhooks normalize into InboundMessageReceived; core conversation engine provider-independent.

## 111-116. Business Time + Timezone + Bulk Action + Batch Progress + Cancellation + Import
All timestamps UTC; scheduling policies evaluate prospect/mailbox/workspace timezone/business hours. Unknown timezone + local-hours safety → WAIT or configured conservative fallback. Bulk action 2,000 prospects: request→validate scope→permission→policy→approval if threshold→batch→chunks→per-entity eligibility→individual external actions. Batch progress: Total/Eligible/Executed/Waiting/Blocked/Failed. Pause during batch: CampaignPaused→no new execution; already-succeeded sends remain historical; queued actions re-evaluate and wait/cancel; can't unsend. CSV import: upload→parse→validate→field mapping→preview→dedupe→confirm→chunked import→entity resolution→ImportCompleted; no bypass of identity rules.

## 117-119. Knowledge Publishing + Data Revalidation + Human Correction
Draft→Review→Approval→Publish→KnowledgePublished→embedding/index job→available to AI. Pricing change → invalidate relevant caches→new embeddings→future contexts use new effective version; historical conversation tied to version used. Stale: scheduler identifies contact verification/website/employment/owner → RevalidationRequested→research/verification→new evidence→fact confirmed/superseded/conflicted; never silent rewrite. Human correction: John is not owner → permission→evidence/note if available→invalidate/supersede fact→canonical update→HumanCorrectionRecorded→AI context immediately respects. One correction doesn't auto-modify global model/prompt; becomes learning candidate.

## 120-124. Full Trace + Failure Trace + Hard Suppression + Event Naming + Command Naming
Prospect reply: InboundProviderEventReceived→InboundMessageNormalized→MessageStored→ReplyReceived→CampaignFollowUpsCancelled→ReplyClassificationRequested→ReplyClassified→QualificationExtractionRequested→QualificationUpdated→NextBestActionRequested→AIReplyProposed→PolicyEvaluated→ExternalActionPrepared→EmailSendQueued→ExternalActionRevalidated→EmailSent. Same correlation ID. Pricing low-confidence/uncertain → PolicyEvaluated→ASK→ApprovalRequested→Human Attention; nothing sent; human approves → ApprovalGranted→Continuation→Current-state revalidation→EmailSent. If UnsubscribeReceived before execution → SuppressionCreated→pending external action revalidation→BLOCKED; human approval never overrides hard unsubscribe. Naming: events past-tense business language (CompanyDiscovered/ContactVerified/CampaignStarted/ReplyReceived/MeetingBooked/OpportunityWon) — no vague ThingUpdated/ProcessDone. Commands imperative (DiscoverCompanies/VerifyContact/StartCampaign/SendEmail/BookMeeting/ChangeOpportunityStage).

## 125-126. Event Registry + Workflow Registry + Observability per Workflow
Event registry: name, version, owner module, payload schema, consumers, PII classification, replay safe?, created when. Workflow registry: trigger, steps, state machine, queues, policies, external side effects, failure behavior. Per execution: correlation_id, workflow, current step, duration, retries, provider latency, AI latency, policy outcome, failure reason → Screen #18 diagnose "why replies take 3 minutes?".

## 127-130. SLA Monitoring + Poison Jobs + Graceful Shutdown + Deployment + Queue Data Retention
Inbound reply→classified within target SLA; backlog → SLA risk → high-priority worker scaling. Poison jobs: malformed job crashes worker → attempt threshold → DLQ, no infinite retry. Graceful shutdown: stop claiming new jobs, finish safely, release locks, shutdown; ExternalAction state allows safe retry after restart. New version deployment: persistent Redis+DB workflow state; schema migrations compatibility with active jobs/events; event versions help. BullMQ jobs can be cleaned; historical truth lives in DomainEvent/ExternalAction/AuditLog/Activity/domain entities, not old Redis payloads.

## 131-136. Event Retention + Privacy Deletion + Performance + Critical vs Non-Critical + Workflow Priority
Separate retention: business domain events / audit / operational logs / raw provider events. Event payloads avoid unnecessary PII; prefer IDs+minimal business data; retention/redaction under governance. Events shouldn't trigger 40 immediate DB-heavy handlers synchronously; async fan-out via jobs. Critical: sequence protection/conversation state/suppression detection on ReplyReceived. Non-critical: daily analytics/experiment metrics/historical aggregates can lag. Priority principle: RELATIONSHIP PROTECTION > ACTIVE SALES > SCHEDULED OUTREACH > NEW PROSPECTING > BACKGROUND INTELLIGENCE.

## 137-141. Event Security + Actor Types + AI Authority Continuity + Human vs System Initiated
Event consumers execute under system identity but retain original actor/workspace/authority context. No background job gains more authority merely because server-side. Actor types: USER/AI_AGENT/SYSTEM/EXTERNAL_PERSON/PROVIDER. AI Authority Continuity: "Give 30% discount" → background worker can't say "I'm SYSTEM now"; original requester authority + AI authority + business policy all relevant. Inbound reply/scheduled signal scan/provider webhook → system policy determines allowed response.

## 142-147. Workflow Testing + Most Important Invariant Tests + Simulation + Shadow AI + Canary Autonomy
Every critical workflow tested: happy path/duplicate event/retry/out-of-order/policy block/suppression/provider failure/human approval/stale approval/kill switch/worker crash. Critical: Email/Meeting/Unsubscribe/Opportunity/Entity merge. Invariant automated tests: genuine reply must stop cold follow-ups; suppressed contact never receives automated outreach; same idempotency key never two external sends; AI cannot execute beyond current policy; calendar booking requires current real availability; replaying event must not resend email. Workflow simulation: shadow/dry run campaign would enroll 312/block 48/request approval/use approx X provider units, no external send. Shadow AI: makes decisions ("I WOULD reply automatically") but no execution; compare AI vs human before increasing autonomy. Canary autonomy: 10 prospects→observe→50→observe→larger cohort.

## 148-150. Event-Driven Command Center + Runtime Architecture + Locked Technology Decision
DomainEvent→read model/projection→SSE→authorized browser for Command Center live updates (market discovery progress/AI activity/replies/campaign status/attention). Runtime: USER/PROVIDER/SCHEDULER→COMMAND→Auth/Authority/Validation→DOMAIN SERVICE→DB+Outbox→EVENT DISPATCHER→REALTIME/OUTBOUND/BACKGROUND workers→new commands→domain changes→events↺. Locked stack for v1: PostgreSQL + Prisma + Transactional Outbox + BullMQ + Redis + NestJS Workers + Scheduler + REST + SSE. Not initially: Kafka/RabbitMQ/Temporal/Camunda/Kubernetes.

## 151. Final Workflow Rule
TRIGGER → CURRENT STATE → AUTHORITY → BUSINESS RULES → EVIDENCE/FRESHNESS → POLICY → IDEMPOTENCY → EXECUTE → PERSIST RESULT → EVENT → AUDIT → LEARN. For external actions: a queued action is never permission to blindly execute later; current state must be checked again immediately before the side effect.

## Specification Status
#1 Complete System Architecture ✓ LOCKED. #2 Master Database & Data Model ✓ LOCKED. #3 Event Architecture & Workflow ✓ LOCKED. Next: #4 AI Agent Architecture — exact design of AI Sales Manager/Market Hunter/Research/Contact/Signal/Campaign/Conversation/Qualification/Scheduling/Learning agents: tools, access, coordination, context, how direct Gmail/DB authority is prevented.
