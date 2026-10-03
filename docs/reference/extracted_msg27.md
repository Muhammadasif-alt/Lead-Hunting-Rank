Bilkul. Ab **coding nahi**. Master Specification ka next step **Product UX + Operational Flow Specification** hai.

Is stage mein hum decide karenge ke 4–5 team members software ko actually **kaise operate karenge**. Iske baad hi technical architecture/database par jayenge.

### Ab order ye rahega

**Step 1 — Navigation & Screens lock karna.** Main initial sidebar ye rakhunga:

```text
COMMAND CENTER

01  Dashboard
02  AI Sales Manager

PROSPECTING

03  Lead Hunter
04  Prospects
05  Companies
06  Buying Signals

OUTREACH

07  Campaigns
08  Conversations
09  Tasks

SALES

10  Opportunities
11  Calendar
12  Contacts

INTELLIGENCE

13  Analytics
14  Experiments
15  AI Memory

SYSTEM

16  Knowledge Base
17  Integrations
18  Team
19  Settings
```

Lekin har screen ka purpose crystal clear hoga. Example **Lead Hunter** sirf leads ki list nahi hoga. User likhe:

```text
Find SaaS companies in the US
with 20–100 employees,
currently hiring React developers.

Target CTO / VP Engineering.
```

Phir screen live process dikhaye:

```text
AI LEAD HUNTER
────────────────────────────────────

Companies discovered       1,284
Analyzed                     613
ICP matched                  147
Buying signal                 63
Decision maker found          51
Verified contact              42

🔥 HIGH PRIORITY

Acme SaaS
ICP              94%
Intent           High
Person           CTO
Signal           Hiring 3 React Developers

WHY AI SELECTED THIS
→ Matches ICP
→ Active engineering hiring
→ Correct decision maker
→ Strong capacity hypothesis

[Research] [Add to Campaign] [Ignore]
```

**Step 2 — Har screen ka full specification.** Dashboard par kya metrics/cards honge, Prospect Detail mein kya tabs honge, Company 360° view kya dikhayega, Campaign Builder ka exact wizard kya hoga, Conversations mein AI/Human handoff kaise hoga, AI Manager kya commands le sakta hai — sab define karenge.

**Step 3 — End-to-end workflows.** Example:

```text
Goal Created
     ↓
AI searches market
     ↓
Companies discovered
     ↓
Research
     ↓
ICP scoring
     ↓
Buying signals
     ↓
Decision maker
     ↓
Contact verification
     ↓
Opportunity hypothesis
     ↓
AI selects outreach strategy
     ↓
Campaign
     ↓
Email
     ↓
Reply
     ↓
AI conversation
     ↓
Qualification
     ↓
Meeting
     ↓
Opportunity
     ↓
Won / Lost
     ↓
Learning
```

Har arrow ke rules separately define honge.

**Step 4 — AI Decision Matrix.** Ye project ka sabse important document hoga. Har situation ke liye decide karenge AI `AUTO`, `ASK HUMAN`, `STOP`, ya `ESCALATE` kare.

Example:

```text
Unsubscribe             → AUTO STOP
Positive reply          → AUTO HANDLE
Simple question         → AUTO ANSWER
Pricing question        → RULE DEPENDENT
Discount request        → HUMAN
Contract/legal          → HUMAN
Angry prospect          → HUMAN
Unknown answer          → DON'T INVENT
Meeting request         → AUTO BOOK
Email bounced           → AUTO STOP
Not now                 → AUTO NURTURE
Wrong person            → FIND CORRECT PERSON
```

**Step 5 — Data + Memory specification.** Prospect ke baare mein kya permanently store hoga, facts vs AI assumptions, conversation memory, company relationships, signals, objections, promises, qualification, revenue attribution etc.

**Step 6 — Intelligence specification.** Yahin product GHL se noticeably aage jayega: Next Best Action, account intelligence, intent changes, self-learning experiments, campaign optimization, lost-lead resurrection, relationship graph, AI Sales Manager aur goal-driven autonomy.

**Step 7 — Guardrails + compliance + failure handling.** Duplicate emails, wrong AI answer, API failure, opt-out, bad data, mailbox issue, hallucination, conflicting agents, human takeover, global kill switch—har edge case.

**Step 8 — Phases lock karenge.** Master spec huge ho sakti hai, isliye features delete nahi karenge; delivery phases mein divide karenge:

```text
PHASE 1
Foundation + CRM + Email

PHASE 2
Lead Hunter + Research

PHASE 3
AI Outreach + Conversations

PHASE 4
Qualification + Booking

PHASE 5
Signals + Intelligence

PHASE 6
AI Sales Manager

PHASE 7
Learning + Experiments

PHASE 8
Advanced Autonomous Revenue OS
```

Uske **baad** hum technical specification par jayenge: Next.js/NestJS modules → DB → queues → APIs → AI orchestration → deployment. Aur uske baad coding.

### Ab immediately kya karna chahiye

**Screen #1: Command Center / Dashboard** ko fully specify karte hain. Tumne jo green/black gradient banwaya hai, woh visual direction bhi isi dashboard/login/hero system mein use ho sakti hai.

Main next mein Command Center ko **section-by-section** design karunga — top bar se lekar KPIs, live AI activity, pipeline, hot leads, human-attention queue, buying signals, AI recommendations, meetings aur quick commands tak. Is baar sirf feature names nahi, balki **exactly screen par kya hoga aur click karne par kya hoga** define karenge.