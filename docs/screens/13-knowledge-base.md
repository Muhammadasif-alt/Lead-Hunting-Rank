Bilkul. Ab **Screen #13: Knowledge Base + Business Brain** ko lock karte hain.

Ye poore autonomous system ke sabse critical screens mein se ek hai. Lead Hunter AI ko market samjhata hai, Memory prospects ko samjhati hai, lekin **Knowledge Base AI ko hamari apni company samjhata hai**.

Core rule:

> **AI sirf wahi commercial claims, pricing, capabilities aur policies confidently communicate kare jo approved Business Brain se grounded hon. Agar answer available ya sufficiently reliable nahi hai, AI guess nahi karega.**

# Screen #13: Knowledge Base + Business Brain

Main screen:

```text
KNOWLEDGE BASE                     Business Brain ● HEALTHY

[Overview] [Services] [Pricing] [FAQs] [Policies]
[Integrations] [Case Studies] [Competitors] [Documents]
[AI Knowledge Gaps]

──────────────────────────────────────────────────

BUSINESS BRAIN

Approved Knowledge          428
Draft / Review               17
Stale                         9
Conflicting                   3
AI Knowledge Gaps            12

AI ANSWER READINESS
94%

──────────────────────────────────────────────────

NEEDS ATTENTION

⚠ Multi-location pricing needs approval
⚠ Jobber integration article needs revalidation
⚠ 7 prospects asked a question AI cannot answer
⚠ Case study metrics missing source
```

## 1. Business Profile

Sabse pehle AI ko company ki identity pata honi chahiye:

```text
BUSINESS PROFILE

Company Name
ABC Digital

What We Do
Websites
AI Automation
CRM Automation
Lead Follow-up
AI Chat

Primary Markets
Local service businesses

Regions Served
USA
Canada

Business Model
Project + Recurring Services
```

Iske neeche:

```text
POSITIONING

We help:
Local service businesses

With:
Lead capture
Lead response
Sales automation

We are NOT:
...
```

Ye campaign generation se proposal tak reusable hoga.

---

# 2. Services Catalog

Har service structured object hogi.

```text
SERVICE

AI Lead Automation

STATUS
Active

CATEGORY
Automation

IDEAL FOR
Businesses receiving inbound inquiries

PROBLEMS IT ADDRESSES

• Slow response
• Manual follow-up
• Missed leads
• Inconsistent qualification

CAPABILITIES

✓ Lead capture
✓ Automated response
✓ Qualification workflows
✓ CRM routing
✓ Meeting scheduling

LIMITATIONS

✕ Unsupported integrations unless verified
✕ No guaranteed revenue outcome
```

---

# 3. Service Detail

AI ko marketing paragraph se zyada structured knowledge chahiye.

```text
AI LEAD AUTOMATION
──────────────────────────────

Overview
Use Cases
Capabilities
Requirements
Limitations
Pricing
FAQs
Integrations
Proof
Related Services
Approved Claims
Prohibited Claims
```

---

# 4. Ideal Customer per Service

Global ICP aur service fit separate ho sakte hain.

Example:

```text
WEBSITE REDESIGN

Strong Fit

• No website
• Broken/outdated website
• Poor mobile experience
• Missing lead capture


AI AUTOMATION

Strong Fit

• Existing inquiry volume
• Manual follow-up
• Multiple lead sources
• Response delays
```

Lead Hunter opportunity engine isi knowledge ko use karega.

---

# 5. Service Requirements

AI ko pata hona chahiye service kin conditions mein feasible hai.

```text
AI CHAT

REQUIREMENTS

Website access
Approved knowledge
Lead destination
Business hours
Escalation contact

OPTIONAL

CRM integration
Calendar integration
SMS provider
```

Qualification automatically relevant requirements gather kar sakti hai.

---

# 6. Service Limitations

Very important:

```text
LIMITATIONS

AI Chat cannot:

• Guarantee conversion
• Answer unsupported legal questions
• Invent unavailable pricing
• Promise unsupported integrations
```

AI ko sirf “what we can do” nahi, **“what we cannot promise”** bhi pata hoga.

---

# 7. Pricing Knowledge

Dedicated structured pricing:

```text
PRICING

Website Starter
$X

Website Professional
$Y

AI Automation
Starting from $Z

Custom Integration
Requires assessment
```

But pricing fields ke saath authority:

```text
DISCLOSURE POLICY

Publicly shareable       YES
AI may explain           YES
AI may quote             YES
AI may discount          NO
Custom quote             HUMAN APPROVAL
```

---

# 8. Pricing Matrix

Complex pricing:

```text
AI AUTOMATION

Base Setup              $X

Optional

CRM Integration         $Y
Extra Location          $Z
Advanced Workflow       Custom
```

Conditions explicitly stored.

AI calculation kar sakta hai only where deterministic approved rules exist.

---

# 9. Pricing Versioning

Pricing changes:

```text
PRICING HISTORY

v4
Effective Oct 1

v3
Jun 1 – Sep 30

v2
Previous
```

Critical because old proposal:

```text
Proposal sent Sep 20
```

must be interpreted using pricing that existed Sep 20.

---

# 10. No Invented Pricing

Prospect:

> “How much for 8 locations?”

Knowledge:

```text
1–5 locations:
Approved

6+ locations:
Custom pricing
```

AI response flow:

```text
PRICING REQUEST
      ↓
No approved deterministic price
      ↓
DO NOT CALCULATE
      ↓
Escalate / gather requirements
```

---

# 11. Discount Rules

```text
DISCOUNTS

AI Authority:
NONE

Salesperson:
Up to configured limit

Admin:
Higher configured authority
```

Could support:

```text
Annual Payment Discount
Approved: 10%
```

Then AI may communicate it if explicitly authorized.

But it can't invent:

> “I can give you another 15%.”

---

# 12. Payment Terms

Structured:

```text
PAYMENT TERMS

Standard

50% upfront
50% on completion

Recurring services
Monthly billing

Custom payment plan
Human approval
```

Again, commercial truth comes from KB.

---

# 13. FAQ Library

```text
FAQs

PRICING
12

IMPLEMENTATION
18

INTEGRATIONS
31

SUPPORT
16

SECURITY
9

BILLING
7

TECHNICAL
24
```

Each FAQ:

```text
QUESTION

How long does implementation take?

APPROVED ANSWER

Typical implementation depends on scope...

ALLOWED CLAIMS
...

ESCALATE IF
Custom integration / unusual scope

STATUS
Approved
```

---

# 14. Semantic Questions

Prospect doesn't need exact FAQ wording.

Knowledge:

```text
How long does setup take?
```

Prospect:

> “How soon could we get this running?”

AI semantic retrieval should find same approved knowledge.

---

# 15. Answer Confidence

Before answering:

```text
QUESTION
Does this integrate with Jobber?

MATCHED KNOWLEDGE

Jobber Integration
Approved
Last verified: Sep 2026

Confidence:
HIGH

→ Answer
```

But:

```text
QUESTION
Does it integrate with XYZPro v9?

Knowledge:
No reliable answer

→ HUMAN
```

---

# 16. "I Don't Know" Is Valid

One of our system rules:

```text
NO APPROVED KNOWLEDGE
        ↓
DO NOT INVENT
        ↓
ASK CLARIFYING QUESTION
OR
ESCALATE
```

A trustworthy AI saying:

> “I need to confirm that.”

is better than hallucinating a capability.

---

# 17. Knowledge Sources

Knowledge can originate from:

```text
Human-created article
Approved document
Website
Product documentation
Pricing sheet
Internal SOP
Approved human answer
Integration documentation
Case study
Contract/policy reference
```

Every article has provenance.

---

# 18. Documents Library

User can upload:

```text
PDF
DOCX
TXT
Markdown
Supported structured files
```

Examples:

```text
Pricing.pdf
Services.docx
Sales-FAQ.pdf
Integration-Guide.pdf
Case-Studies.pdf
```

But uploaded document ≠ automatically approved truth.

---

# 19. Document Processing Flow

```text
UPLOAD
   ↓
PARSE
   ↓
CHUNK / STRUCTURE
   ↓
CLASSIFY
   ↓
EXTRACT KNOWLEDGE CANDIDATES
   ↓
DETECT CONFLICTS
   ↓
HUMAN REVIEW
   ↓
APPROVE
   ↓
PRODUCTION KNOWLEDGE
```

This is much safer than blindly RAG-ing every uploaded file.

---

# 20. Knowledge Status

Each item:

```text
DRAFT
IN REVIEW
APPROVED
STALE
CONFLICT
ARCHIVED
REJECTED
```

Only approved current knowledge gets maximum answer authority.

---

# 21. Knowledge Authority Levels

Not all sources equal.

Conceptually:

```text
1. APPROVED POLICY
2. APPROVED STRUCTURED KNOWLEDGE
3. APPROVED DOCUMENTATION
4. HUMAN NOTE
5. PUBLIC WEBSITE
6. HISTORICAL RESPONSE
```

If historical email conflicts with current pricing policy:

**Current approved pricing wins.**

---

# 22. Conflict Detection

Example:

```text
Pricing.pdf

Setup:
$2,000
```

Website says:

```text
Starting at $1,500
```

System:

```text
⚠ KNOWLEDGE CONFLICT

Topic:
Setup Pricing

Source A:
Pricing v4

Source B:
Website

Do not let AI resolve silently.

[Review]
```

---

# 23. Effective Dates

Knowledge:

```text
Pricing v5

Effective:
November 1
```

Current date Oct 20.

AI should still use:

```text
v4
```

until v5 becomes active.

Supports future scheduled changes.

---

# 24. Expiration / Revalidation

Integration capability:

```text
Jobber Integration

Last verified:
6 months ago

Revalidation policy:
Every 90 days
```

System:

```text
⚠ STALE KNOWLEDGE
```

Depending on policy, AI may qualify answer or escalate.

---

# 25. Approved Claims

Service:

```text
APPROVED CLAIMS

✓ Automates configured lead follow-up
✓ Can route leads to CRM
✓ Supports approved calendar workflows
```

---

# 26. Prohibited Claims

```text
PROHIBITED CLAIMS

✕ Guaranteed 3x revenue
✕ Guaranteed rankings
✕ Guaranteed conversion increase
✕ "Works with every CRM"
✕ "100% automated"
✕ Unsupported security certification
```

AI Quality Review checks outbound messages against this.

---

# 27. Claim Evidence

Case study says:

```text
Response time reduced from X to Y
```

Store:

```text
CLAIM

Source:
Case Study #CS-014

Client:
...

Period:
...

Evidence:
...

Allowed usage:
Sales conversations ✓
Website marketing ✓/✕
Anonymous usage ✓/✕
```

No random social-proof numbers.

---

# 28. Case Studies

Dedicated library:

```text
CASE STUDIES

GreenCo
Landscaping

Problem
Slow lead response

Solution
AI lead automation

Outcome
Approved documented outcome

Services
Automation + CRM

Persona
Owner

Market
Texas
```

Campaign AI can select relevant case study.

---

# 29. Case Study Matching

Prospect:

```text
Industry:
Landscaping

Problem:
Missed website inquiries
```

AI finds:

```text
CASE STUDY MATCH

GreenCo

Industry relevance     HIGH
Problem relevance      HIGH
Service relevance      HIGH
```

Then use only approved facts from case study.

---

# 30. Case Study Restrictions

Some customers may permit internal use but not public naming.

```text
USAGE RIGHTS

Internal sales        ✓
Named externally      ✕
Anonymous reference   ✓
Website               ✕
```

AI respects this.

---

# 31. Integration Knowledge

Dedicated area:

```text
INTEGRATIONS

Jobber
HubSpot
GoHighLevel
Google Calendar
Gmail
Zapier
...
```

Each:

```text
JOBBER

Status
Supported

Integration Type
API / workflow / custom

Capabilities
...

Limitations
...

Setup Requirements
...

Last Verified
...

Owner
Technical Team
```

---

# 32. Integration Status

Use exact statuses:

```text
NATIVE
SUPPORTED
SUPPORTED WITH CONDITIONS
CUSTOM
PLANNED
NOT SUPPORTED
UNKNOWN
```

AI must distinguish `PLANNED` from `SUPPORTED`.

---

# 33. Competitor Knowledge

Dedicated internal section:

```text
COMPETITORS

GoHighLevel
Competitor B
Competitor C
```

But no uncontrolled trash-talking.

Structure:

```text
COMPETITOR

Known capabilities
Our documented differences
Where we're stronger
Where they're stronger
When we're not a fit
Approved comparison statements
Unknowns
Last checked
```

---

# 34. Competitor Response

Prospect:

> “Why not just use GoHighLevel?”

AI loads approved comparison.

Response can explain relevant differences based on current approved knowledge, without inventing competitor limitations.

---

# 35. Battlecards

For sales:

```text
GHL BATTLECARD

When prospect values:
...

Ask:
...

Our relevant differentiation:
...

Do NOT claim:
...

Potential objection:
...

Evidence:
...
```

Available inside Conversations and Meetings.

---

# 36. Business Policies

Dedicated:

```text
POLICIES

Refunds
Cancellation
Implementation
Support
Service levels
Data handling
Discounts
Payment
Contract
Trials
Guarantees
```

Each has exact authority.

---

# 37. Policy Decision Tree

Example:

```text
REFUND REQUEST
      ↓
Within approved policy?
      ↓
YES
Explain policy
      ↓
NO / EXCEPTION
Human escalation
```

AI doesn't negotiate policy exceptions itself.

---

# 38. Sales Rules vs Business Facts

Separate:

```text
BUSINESS FACT

AI Automation includes X.
```

from:

```text
SALES RULE

Don't discuss custom discount
without approval.
```

Both may affect response, but they're different knowledge types.

---

# 39. Communication Rules

Global messaging policies:

```text
DO

Be concise
Be specific
Use plain English
Answer direct questions
Acknowledge uncertainty


DON'T

Fake familiarity
Invent facts
Use fake urgency
Guarantee results
Overstate capability
Pretend a case study applies exactly
```

Campaign and Conversation engines both consume these.

---

# 40. Brand Voice

Configurable:

```text
BRAND VOICE

Professional
Direct
Conversational
Confident but not exaggerated

Preferred:
Short paragraphs
Plain language

Avoid:
Corporate fluff
Excessive emojis
Aggressive closing
```

Can vary by channel.

---

# 41. Channel-Specific Knowledge

Example:

```text
EMAIL

More context allowed


SMS

Concise
Consent/channel rules


PROPOSAL

Formal commercial language


WEBSITE CHAT

Short interactive answers
```

One voice, different execution.

---

# 42. Proposal Knowledge

Reusable approved sections:

```text
Company Overview
Service Description
Scope
Deliverables
Implementation
Support
Pricing
Terms
Case Studies
FAQ
```

Proposal Engine assembles from approved blocks.

---

# 43. Proposal Variables

```text
{{company_name}}
{{service}}
{{approved_price}}
{{timeline}}
{{deliverables}}
```

But variable values come from opportunity/approved pricing.

No uncontrolled generated commercial commitments.

---

# 44. Contract Knowledge

AI can understand:

```text
Standard contract terms
```

but:

```text
LEGAL MODIFICATION REQUEST
```

→ human.

Example:

> “Can you change liability clause?”

```text
HUMAN REQUIRED
```

No AI autonomous legal negotiation.

---

# 45. Security Knowledge

Prospect:

> “How is our data protected?”

AI should use approved security documentation.

```text
SECURITY

Encryption
Access controls
Retention
Hosting
Backups
Subprocessors
```

Only actual implemented facts.

---

# 46. Compliance Knowledge

Same principle:

```text
COMPLIANCE

Supported claims only.
```

AI cannot spontaneously claim:

```text
SOC 2 certified
HIPAA compliant
GDPR certified
```

unless approved factual evidence supports exact claim.

---

# 47. Knowledge Gap Detection

Conversation Engine sees:

```text
QUESTION

"Can your system sync multiple
Jobber locations separately?"
```

No answer.

Creates:

```text
KNOWLEDGE GAP

Topic:
Jobber Multi-Location

Asked:
7 times

Revenue context:
3 active opportunities

Priority:
HIGH
```

This is extremely useful.

---

# 48. Knowledge Gap Priority

Rank based on:

```text
Frequency
Opportunity value
Pipeline stage
Number of affected prospects
Current AI failure rate
Urgency
```

Not just number of questions.

---

# 49. Human Answer → Knowledge Candidate

Human answers prospect:

```text
"Yes, but it requires..."
```

System:

```text
POTENTIAL KNOWLEDGE ARTICLE

Generated from:
Human-approved response

[Review]
```

Once approved, future AI can answer it.

---

# 50. Knowledge Improvement Loop

```text
PROSPECT QUESTION
       ↓
AI SEARCH
       ↓
NO APPROVED ANSWER
       ↓
HUMAN ANSWERS
       ↓
KNOWLEDGE CANDIDATE
       ↓
REVIEW
       ↓
APPROVED ARTICLE
       ↓
FUTURE AI ANSWERS
```

This makes AI smarter from actual business operations without blindly learning.

---

# 51. AI Answer Simulator

Very important admin tool.

User enters:

```text
Prospect asks:

"Can you integrate with Jobber and
how much would it cost for 10 locations?"
```

System shows:

```text
AI WOULD ANSWER

Integration:
Supported with conditions

Pricing:
Cannot quote 10-location custom pricing.

ACTION:
Answer integration portion.
Escalate pricing portion.
```

Admin can test Business Brain before production.

---

# 52. Persona Test Simulator

Test same question as:

```text
Cold Prospect
Existing Customer
Qualified Opportunity
Proposal Stage
```

AI answer may differ because authority/context differs.

Useful before deploying policy changes.

---

# 53. Knowledge Citation Internally

AI-generated response audit:

```text
ANSWER

"Yes, Jobber integration is supported
under..."

USED KNOWLEDGE

KB-INT-014
Jobber Integration
Version 4

KB-PRICE-002
Automation Pricing
Version 7
```

Full traceability.

---

# 54. Knowledge Usage Analytics

```text
MOST USED KNOWLEDGE

Pricing                     218 answers
Implementation              174
Jobber Integration           91
Support                      84
```

Then:

```text
LOW CONFIDENCE TOPICS

Custom integrations
Security questionnaires
Multi-location pricing
```

---

# 55. Knowledge Effectiveness

Track:

```text
Article used
      ↓
Did question resolve?
      ↓
Did prospect ask same question again?
      ↓
Was human correction needed?
```

Example:

```text
KB-014

Used:
91

Human correction:
17

Potential issue:
Article may be unclear or incomplete.
```

---

# 56. Knowledge Feedback

Salesperson:

```text
[Helpful]
[Outdated]
[Incorrect]
[Incomplete]
```

If multiple reports:

```text
⚠ KNOWLEDGE REVIEW REQUIRED
```

---

# 57. Knowledge Versioning

Every article:

```text
JOBBER INTEGRATION

v5 — Current
Oct 2

v4
Aug 14

v3
May 20
```

AI actions store which version they used.

---

# 58. Rollback

Bad update:

```text
[Restore v4]
```

New current version generated from rollback.

History preserved.

---

# 59. Approval Workflow

Knowledge changes:

```text
DRAFT
  ↓
REVIEW
  ↓
APPROVED
  ↓
PUBLISHED
```

For small team, configurable:

```text
Normal FAQ
Admin approval

Pricing
Owner approval

Legal policy
Owner approval

Minor wording
Authorized admin
```

---

# 60. Scheduled Publishing

Pricing changes next month:

```text
v8

Publish:
Nov 1, 12:00 AM

Until then:
v7 active
```

System automatically transitions at approved time.

---

# 61. Global vs Service Knowledge

Hierarchy:

```text
GLOBAL BUSINESS KNOWLEDGE
       ↓
SERVICE
       ↓
OFFER / PACKAGE
       ↓
MARKET-SPECIFIC RULE
```

Specific approved rule can override general rule where explicitly configured.

---

# 62. Market-Specific Knowledge

Example:

```text
USA

Pricing:
USD

Canada

Pricing:
CAD / separate pricing
```

Or different service availability.

AI uses correct market context.

---

# 63. Knowledge Precedence

When multiple relevant items exist:

```text
SPECIFIC CURRENT APPROVED POLICY
        ↓
CURRENT APPROVED SERVICE KNOWLEDGE
        ↓
CURRENT APPROVED GENERAL KNOWLEDGE
        ↓
SUPPORTED REFERENCE MATERIAL
```

Conflict → don't guess.

---

# 64. Knowledge Search

Natural language:

> “Jobber ke bare mein hum kya claim kar sakte hain?”

> “AI ko discounts kitne tak allow hain?”

> “Website package mein kya included hai?”

> “Kaun se questions AI answer nahi kar pa raha?”

> “Kaunsi knowledge stale hai?”

> “Multi-location pricing ka latest rule kya hai?”

---

# 65. Knowledge Search Result

```text
QUERY

Can we offer discount?

RESULT

Standard Discount Policy
Version 4

AI Authority:
None

Sales Authority:
Configured limit

Owner:
Higher exceptions

Last Updated:
Oct 1

[Open Policy]
```

---

# 66. AI Knowledge Context Builder

When prospect asks question:

```text
QUESTION
      ↓
Intent
      ↓
Relevant service
      ↓
Relevant KB retrieval
      ↓
Current version
      ↓
Authority / policy
      ↓
Opportunity context
      ↓
Generate answer
      ↓
Grounding check
      ↓
Send / escalate
```

---

# 67. Knowledge Retrieval Must Respect Scope

If prospect asks Website pricing:

Don't load:

```text
CRM implementation manual
Every competitor battlecard
Entire company documentation
```

Retrieve only relevant approved context.

Better accuracy + lower token cost.

---

# 68. Grounding Check

Before send:

```text
CLAIMS IN DRAFT

1. Jobber integration supported
   → Grounded ✓

2. Setup takes 3 days
   → No approved evidence ✕

3. Pricing starts at $X
   → Grounded ✓
```

Result:

```text
SEND BLOCKED

Unsupported claim detected:
"Setup takes 3 days."
```

This is a major protection layer.

---

# 69. Claim-Level Grounding

We should eventually evaluate response claim-by-claim, not merely:

```text
RAG found something
→ safe
```

Because one paragraph can contain five claims and only three may be supported.

---

# 70. Contradiction Check

Generated:

> “We support unlimited locations.”

KB:

```text
Multi-location:
Custom assessment required.
```

System catches contradiction before send.

---

# 71. Pricing Validator

Generated:

```text
Total:
$7,200
```

Validator independently recalculates from structured pricing rules where possible.

If mismatch:

```text
⚠ PRICING VALIDATION FAILED

Expected:
...

Generated:
...

SEND BLOCKED
```

LLM should not be final arithmetic authority for important commercial totals.

---

# 72. Policy Validator

Generated reply asks for unsupported guarantee.

Validator:

```text
GUARANTEE POLICY
No guaranteed revenue claims

Violation detected

→ Block
```

---

# 73. Knowledge Coverage Map

Visual:

```text
BUSINESS BRAIN COVERAGE

Services            ██████████  Strong
Pricing             █████████   Good
Integrations        ███████     Needs Work
Security            █████       Weak
Support             █████████   Good
Case Studies        ██████      Medium
Competitors         ████        Weak
```

Based on actual completeness/use, not arbitrary decoration.

---

# 74. Revenue-Weighted Knowledge Gaps

Suppose obscure question asked 20 times by low-value cold prospects.

Another question asked twice in $50k opportunities.

Priority:

```text
HIGH

Security / Data Residency
Affected Pipeline:
$100K
```

Better than frequency alone.

---

# 75. Knowledge Owners

Each domain can have owner:

```text
Pricing
Owner: Simon

Technical Integrations
Owner: Mike

Sales Messaging
Owner: Alex
```

Review requests routed correctly.

---

# 76. Review Queue

```text
KNOWLEDGE REVIEW

HIGH

Multi-location pricing
Affects 3 opportunities

HIGH

Integration limitation conflict
Affects proposal-stage deal

MEDIUM

Case study wording

LOW

General FAQ update
```

---

# 77. Bulk Knowledge Update

Example service renamed.

System shows dependencies:

```text
SERVICE NAME CHANGE

Affected:

12 KB articles
4 campaign templates
3 proposals
7 case studies
2 active experiments

[Review Impact]
```

Don't blindly replace historical documents.

---

# 78. Knowledge Dependency Graph

Conceptually:

```text
SERVICE
  │
  ├── Pricing
  ├── FAQs
  ├── Integrations
  ├── Case Studies
  ├── Campaigns
  ├── Proposals
  └── Policies
```

This becomes powerful when knowledge changes.

---

# 79. Archived Knowledge

Old service:

```text
STATUS
Discontinued
```

Archive it.

Existing historical conversations still retain reference to old version.

New campaigns can't use it.

---

# 80. Product/Service Availability

```text
AI Chat

STATUS
Active

AVAILABLE
USA ✓
Canada ✓
UK ✕

NEW SALES
Allowed ✓
```

AI won't sell unavailable service in wrong market.

---

# 81. Knowledge + Lead Hunter

Lead Hunter detects:

```text
No booking system
```

Business Brain knows:

```text
We offer:
Online Booking Automation
```

Opportunity Engine can map:

```text
Observed gap
      ↓
Relevant service
```

without fabricating need.

---

# 82. Knowledge + Campaigns

Campaign Engine asks:

```text
What can we truthfully offer this segment?
```

Business Brain provides:

```text
Relevant services
Approved positioning
Case studies
Allowed claims
Restrictions
```

---

# 83. Knowledge + Conversations

Prospect asks:

```text
"What does it cost?"
```

Conversation Engine:

```text
Opportunity context
+
Pricing KB
+
Authority policy
```

→ safe answer.

---

# 84. Knowledge + Meetings

Pre-meeting brief can include:

```text
RELEVANT KNOWLEDGE

Jobber integration
Supported with conditions

Pricing
Custom multi-location

Case study
Relevant landscaping client

Potential limitation
Requires API access
```

Salesperson prepared.

---

# 85. Knowledge + Opportunities

Opportunity requirements:

```text
10 locations
Jobber
SMS
```

System compares with Business Brain:

```text
Jobber               Supported
SMS                  Supported
10 Locations         Custom assessment
```

Shows feasibility before proposal.

---

# 86. Knowledge + Proposals

Proposal builder can only pull:

```text
Approved service descriptions
Approved pricing
Approved terms
Approved case studies
```

Custom generated language passes validators.

---

# 87. Knowledge + Experiments

Experiment may test:

```text
Lead Automation positioning
```

But cannot test:

```text
"Guaranteed 2x leads"
```

if claim prohibited.

Experiment Engine is constrained by Business Brain.

---

# 88. Knowledge + AI Memory

Keep distinction:

```text
BUSINESS BRAIN

"We support Jobber."
```

vs:

```text
PROSPECT MEMORY

"GreenScape uses Jobber."
```

AI combines them:

```text
GreenScape uses Jobber
+
We support Jobber under X conditions
```

→ relevant response.

---

# 89. Knowledge + AI Sales Manager

Ask:

> “System ki knowledge mein kya missing hai?”

AI:

```text
HIGH PRIORITY GAPS

1. Multi-location pricing
   3 active opportunities

2. Data residency
   2 high-value prospects

3. Advanced Jobber workflow
   Asked 7 times

4. Cancellation policy
   Human correction rate high
```

---

# 90. Business Brain Health

Final health score shouldn't be one meaningless number only.

Show dimensions:

```text
BUSINESS BRAIN HEALTH

Coverage              GOOD
Freshness             GOOD
Conflicts             3
Knowledge Gaps        12
Grounding Quality     HIGH
Pricing Readiness     HIGH
Integration Coverage  MEDIUM
```

---

# 91. Emergency Knowledge Disable

Suppose pricing discovered wrong.

Admin:

```text
[DISABLE ARTICLE]
```

Immediately:

```text
Pricing article unavailable to AI.

Pricing questions:
→ Human escalation
```

No need to shut entire AI system down.

---

# 92. Global Knowledge Kill Rule

For severe issue:

```text
DISABLE AI PRICING ANSWERS
```

or:

```text
DISABLE AI TECHNICAL CLAIMS
```

Granular emergency controls.

---

# 93. Knowledge Audit Trail

Every change:

```text
Oct 2
Pricing v7 approved
Simon

Oct 3
Jobber article edited
Mike

Oct 3
Article approved
Simon

Oct 4
Old security FAQ archived
```

Full accountability.

---

# 94. Business Brain Screen Layout

Final UI:

```text
KNOWLEDGE BASE / BUSINESS BRAIN
────────────────────────────────────────

┌──────────────────────────────────────┐
│ Business Brain Health                │
│ Coverage / Freshness / Gaps          │
└──────────────────────────────────────┘

┌───────────────┐ ┌────────────────────┐
│ Services      │ │ Pricing            │
│ Products      │ │ Packages           │
└───────────────┘ └────────────────────┘

┌───────────────┐ ┌────────────────────┐
│ FAQs          │ │ Integrations       │
└───────────────┘ └────────────────────┘

┌───────────────┐ ┌────────────────────┐
│ Policies      │ │ Case Studies       │
└───────────────┘ └────────────────────┘

┌───────────────┐ ┌────────────────────┐
│ Competitors   │ │ Documents          │
└───────────────┘ └────────────────────┘

┌──────────────────────────────────────┐
│ Knowledge Gaps / Review Queue        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ AI Answer Simulator                  │
└──────────────────────────────────────┘
```

---

# 95. Ultimate Business Brain Flow

```text
BUSINESS INFORMATION
        ↓
STRUCTURE
        ↓
SOURCE
        ↓
REVIEW
        ↓
APPROVE
        ↓
VERSION
        ↓
PUBLISH
        ↓
AI RETRIEVAL
        ↓
GENERATE
        ↓
CLAIM VALIDATION
        ↓
POLICY VALIDATION
        ↓
ANSWER / ESCALATE
        ↓
FEEDBACK
        ↓
KNOWLEDGE GAP
        ↓
IMPROVE
```

# Screen #13 locked

Ab system ka ek aur fundamental rule officially lock hai:

> **LLM knowledge source nahi hai. LLM reasoning/generation layer hai. Business truth approved Knowledge Base se aayegi.**

Aur teen concepts bilkul separate rahenge:

```text
KNOWLEDGE BASE
What OUR business knows / offers / allows

AI MEMORY
What we know about THIS company/person/deal

AI LEARNING
What aggregate outcomes have taught us
```

Ye separation baad mein architecture aur database design mein bohat important hogi.

**Progress: 13 / 18 primary screens complete.**

Next **#14 Tasks + Human Attention Center** hai. Ismein hum normal CRM task list nahi banayenge. Ye AI aur humans ke beech **work handoff system** hoga: kya AI khud kare, kya human ko dena hai, approvals, commitments, deadlines, priority, assignments, overdue work, generated tasks, dependencies, bulk actions aur “Today” operating queue sab isi screen mein lock honge.