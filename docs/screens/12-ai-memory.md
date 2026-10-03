Bilkul. Ab **Screen #12: AI Memory + Relationship Intelligence** lock karte hain.

Ye module system ke liye critical hai, kyun ke AI ko sirf conversation history nahi, balki **structured, sourced, time-aware sales memory** chahiye.

Core principle:

> **AI ko relevant cheez yaad rehni chahiye, lekin har purani baat ko permanent truth nahi samajhna chahiye.**

# Screen #12: AI Memory + Relationship Intelligence

Main screen:

```text
AI MEMORY
─────────────────────────────────────────────────────

[Memory Overview] [Companies] [People] [Relationships]
[Commitments] [Needs Review] [Knowledge Gaps]

MEMORY HEALTH

Active Memories             12,841
High Confidence              9,304
Needs Revalidation             418
Conflicting                     37
Human Review                    12

─────────────────────────────────────────────────────

NEEDS ATTENTION

⚠ GreenScape
Budget information conflicts

⚠ Austin Lawn
Decision maker may have changed

⚠ ABC Landscaping
Promise due today

⚠ Texas Turf
Website-related memory is stale
```

## 1. Memory types

System mein memory ko categories mein divide karenge:

```text
COMPANY MEMORY

Services
Locations
Business model
Technology
Digital presence
Known operational facts


PERSON MEMORY

Professional role
Decision authority
Preferred business contact method
Relationship history
Relevant preferences


CONVERSATION MEMORY

Questions
Objections
Requirements
Timing
Commercial context


OPPORTUNITY MEMORY

Need
Budget
Timeline
Decision process
Competition
Requirements


RELATIONSHIP MEMORY

Previous conversations
Introductions
Referrals
Important interactions


COMMITMENT MEMORY

Our promises
Prospect promises
Due dates


STRATEGY MEMORY

What approach was used
What happened
```

But **Strategy Memory** must not be confused with cross-account Learning Engine.

---

# 2. Memory hierarchy

Memory should attach to correct object.

```text
WORKSPACE
   │
   ├── COMPANY
   │     │
   │     ├── PEOPLE
   │     │
   ├── OPPORTUNITIES
   │     │
   │     ├── CONVERSATIONS
   │     ├── MEETINGS
   │     └── COMMITMENTS
   │
   └── RELATIONSHIPS
```

Example:

> “John prefers Tuesday afternoon.”

Person-level memory.

> “GreenScape uses Jobber.”

Company-level memory.

> “This project needs to launch before December.”

Opportunity-level memory.

This distinction prevents context pollution.

---

# 3. Memory ≠ raw conversation

Suppose 100 emails exist.

AI shouldn't load all 100 every time.

Instead:

```text
RAW EVENTS
      ↓
STRUCTURED EXTRACTION
      ↓
MEMORY
      ↓
CURRENT CONTEXT
```

Raw history remains available for evidence.

---

# 4. Memory Card

Example:

```text
MEMORY

GreenScape uses Jobber.

Type:
Company Technology

Confidence:
HIGH

Source:
John Smith
Email
Oct 2, 2026

Last Confirmed:
Oct 2, 2026

Status:
ACTIVE

[View Evidence]
```

Every important memory has provenance.

---

# 5. Memory provenance

Every extracted fact ideally stores:

```text
memory_id
entity
field/type
value

source_type
source_id

observed_at
extracted_at

confidence

verification_status

valid_from
valid_until / recheck_after

created_by
```

So AI can answer:

> “Humein ye kaise pata?”

---

# 6. Fact vs inference

Memory UI clearly distinguishes:

```text
FACT

John said:
"We currently use Jobber."

Confidence:
HIGH
```

versus:

```text
AI INFERENCE

Their current workflow may involve
manual lead follow-up.

Confidence:
MEDIUM

Basis:
Conversation + website audit
```

Inference future email mein fact ki tarah quote nahi hogi.

---

# 7. Human Notes

Separate type:

```text
HUMAN NOTE

"John prefers concise technical answers."

Added by:
Simon

Oct 3
```

AI can use allowed notes internally.

But UI shows:

```text
SOURCE
Human Note
```

not verified prospect fact.

---

# 8. Memory confidence

Use meaningful labels:

```text
VERIFIED
HIGH
MEDIUM
LOW
UNCERTAIN
```

Confidence depends on:

```text
Source quality
Directness
Recency
Conflicting evidence
Verification
```

No fake precision where unsupported.

---

# 9. Direct prospect statements

Highest-value memory often comes from prospect.

Example:

> “I'm the owner.”

Store:

```text
ROLE
Owner

Source:
Direct prospect statement

Confidence:
HIGH
```

Better than random third-party enrichment.

---

# 10. Conflicting memory

Suppose old:

```text
CRM
HubSpot
```

Later prospect says:

> “We moved from HubSpot to Jobber.”

System:

```text
CONFLICT DETECTED

OLD
HubSpot

NEW
Jobber

Source quality:
New statement stronger

Recommended current value:
Jobber

Historical value:
HubSpot
```

Old fact isn't deleted.

It becomes history.

---

# 11. Temporal memory

Some facts change.

Instead of:

```text
CRM = HubSpot
```

we store conceptually:

```text
HubSpot
Valid until approximately Sep 2026

Jobber
Current from Oct 2026
```

Now historical analysis remains correct.

---

# 12. Memory freshness

Different memories have different lifetimes.

```text
Business Address
Revalidate periodically

Website Status
Revalidate frequently

Decision Maker
Revalidate periodically

Prospect's stated preference
Persistent until contradicted

Pricing request
Historical event

Meeting commitment
Until fulfilled/cancelled
```

One global expiry rule would be wrong.

---

# 13. Stale Memory

Example:

```text
Website:
None

Last checked:
8 months ago
```

System:

```text
⚠ STALE

Do not use "you don't have a website"
without revalidation.
```

Before outreach:

```text
Refresh website status
```

---

# 14. Pre-Action Memory Validation

For important actions:

```text
ACTION
Send personalized outreach

Memory used:
No website

Fresh enough?
NO

→ Revalidate
```

This prevents embarrassing emails.

---

# 15. Relationship Memory

Person:

```text
JOHN SMITH

Relationship Started
Sep 24

First Source
Austin Landscaping Campaign

Conversations
7

Meetings
2

Opportunities
1

Last Interaction
Oct 2

Current Relationship
Active Opportunity
```

Then key context:

```text
IMPORTANT MEMORY

✓ Owner
✓ Uses Jobber
✓ Partner involved
✓ Wants implementation before December
✓ Concerned about integration
```

---

# 16. Contact moves company

Suppose John leaves GreenScape and joins ABC Outdoor.

Do not:

```text
Delete old relationship
```

Instead:

```text
PERSON
John Smith

EMPLOYMENT HISTORY

GreenScape
Owner/Manager
2024–2026

ABC Outdoor
Role ...
2026–
```

But new employment must be verified before use.

---

# 17. Cross-company relationship protection

John's old GreenScape information should not leak into ABC.

Example:

```text
GreenScape budget = $10k
```

must NEVER become:

```text
John's budget = $10k
```

Budget belongs to opportunity/company context.

Entity scoping is essential.

---

# 18. Decision-maker memory

```text
DECISION STRUCTURE

John
Owner
Primary decision maker

Sarah
Partner
Approval involvement

Mike
Operations
Technical influence
```

Source for each relationship separately stored.

---

# 19. Referral memory

John:

> “Talk to Sarah, she handles this.”

System:

```text
RELATIONSHIP EDGE

John
   ↓ referred to
Sarah

Context:
Website project

Source:
Email Oct 4
```

Future outreach can truthfully reference referral where appropriate.

---

# 20. Objection memory

```text
OBJECTION

Existing website provider

Raised:
Sep 28

Current status:
Resolved / Partially resolved / Active

Resolution:
Positioned automation separately
```

AI doesn't ask prospect to repeat same objection.

---

# 21. Question memory

```text
QUESTIONS ASKED

✓ Does it integrate with Jobber?
✓ How long does setup take?
✓ Pricing?
```

If prospect asks again, AI knows question may not have been sufficiently answered.

---

# 22. Answer memory

Store not only question:

```text
QUESTION
Jobber integration

ANSWER PROVIDED
Supported under approved configuration...

SOURCE
AI reply Oct 2

KNOWLEDGE VERSION
KB v4.2
```

If KB later changes:

```text
⚠ Previous answer may be outdated.
```

Very useful.

---

# 23. Promise / Commitment Memory

Dedicated first-class section:

```text
COMMITMENTS

OUR SIDE

Send integration document
Due Oct 4
Owner Simon
OPEN


PROSPECT SIDE

Invite partner to demo
Expected Oct 8
PENDING
```

Not hidden in thread summary.

---

# 24. Promise completion

When file/email sent:

```text
COMMITMENT

Send integration document

✓ COMPLETED

Completed:
Oct 4

Evidence:
Email sent with attachment/reference
```

---

# 25. Overdue commitment

Dashboard:

```text
⚠ PROMISE OVERDUE

GreenScape

We promised:
Integration overview

Due:
Yesterday

[Open Opportunity]
```

This should be high priority.

---

# 26. Preference Memory

Useful professional preferences:

```text
Preferred meeting window
Tuesday afternoon

Preferred channel
Email

Communication preference
Concise technical detail
```

Only when supported by interaction/evidence.

No unnecessary personality profiling.

---

# 27. "Do Not Use in Outreach"

Some information may be useful internally but inappropriate to mention.

Memory field:

```text
USAGE

✓ Internal reasoning
✓ Qualification
✕ Cold personalization
✕ Marketing copy
```

Example: sensitive complaint themes or uncertain inferred information.

---

# 28. Memory Sensitivity

Classify:

```text
NORMAL BUSINESS CONTEXT

RESTRICTED INTERNAL CONTEXT

DO NOT PERSONALIZE FROM THIS

DO NOT SEND TO AI CHANNEL X
```

We should design access controls early rather than bolt them on later.

---

# 29. Memory Permissions

RBAC applies.

Example:

```text
SALES
Relationship memory ✓
Opportunity memory ✓

RESEARCHER
Company intelligence ✓
Pricing negotiation notes ✕

VIEWER
Read allowed summaries only
```

Configurable.

---

# 30. AI Context Builder

When John emails, system shouldn't send entire database to model.

Context builder:

```text
CURRENT MESSAGE
       ↓
Current Conversation
       ↓
Relevant Prospect Memory
       ↓
Relevant Company Memory
       ↓
Active Opportunity
       ↓
Open Commitments
       ↓
Applicable Knowledge
       ↓
Policies
```

Only relevant context gets loaded.

---

# 31. Memory Retrieval

Example message:

> “Can we move the demo to Tuesday?”

Relevant:

```text
Existing meeting
Timezone
Availability
Prospect scheduling preference
Opportunity
```

Irrelevant:

```text
Website CMS
Old review count
Market discovery source
```

Don't waste context window.

---

# 32. Memory priority

Retrieval ranking considers:

```text
Entity relevance
Current conversation
Recency
Confidence
Source quality
Opportunity relevance
Open commitment
Policy relevance
```

This will matter heavily later in technical architecture.

---

# 33. Conversation compression

Long relationship:

```text
87 emails
4 meetings
2 proposals
```

Memory system produces:

```text
RELATIONSHIP SUMMARY

Current state:
Negotiation

Need:
...

Decision structure:
...

Current blockers:
...

Latest commitments:
...

Important historical context:
...

Last meaningful interaction:
...
```

Then raw records remain available on demand.

---

# 34. Summary versioning

Summary isn't permanent truth.

```text
Relationship Summary v17
Generated Oct 2

Based on:
Events through Oct 2
```

New conversation:

```text
Summary v18
```

Previous summary retained/auditable where useful.

---

# 35. Memory extraction after messages

After meaningful incoming/outgoing interaction:

```text
MESSAGE
   ↓
Extract candidate memories
   ↓
Entity resolution
   ↓
Compare existing memory
   ↓
Detect conflict
   ↓
Confidence assessment
   ↓
Save / Review
```

Not every “thanks” becomes memory.

---

# 36. Memory candidate review

Low-confidence/high-impact:

```text
MEMORY CANDIDATE

Possible budget:
$10,000

Evidence:
"We were thinking somewhere around ten..."

Confidence:
Medium

[Confirm]
[Edit]
[Reject]
```

Human can correct.

---

# 37. Memory correction

If AI extracts wrong value:

```text
[Correct]
```

User changes:

```text
Budget
$10,000
→
$100,000
```

Audit:

```text
AI extraction corrected by Simon.
```

Original source remains available.

---

# 38. Correction propagation

If wrong memory was used elsewhere:

```text
Budget correction
```

System checks:

```text
Opportunity summary
Proposal draft
Qualification
AI recommendation
```

and flags affected derived data for refresh.

Powerful requirement.

---

# 39. Memory deletion / invalidation

Business fact wrong:

```text
[Mark Incorrect]
```

Don't necessarily hard-delete audit history.

```text
STATUS
Invalidated

Reason
Incorrect source match
```

AI stops using it.

---

# 40. Entity merge memory

Duplicate businesses:

```text
GreenScape LLC
GreenScape Landscaping
```

Merged.

Memory system must:

```text
Merge compatible facts
Preserve provenance
Detect conflicts
Preserve conversations
Preserve source identities
```

Not flatten everything blindly.

---

# 41. Entity split

If system mistakenly merged two businesses:

```text
[SPLIT ENTITY]
```

Memory provenance lets records return to correct entity.

This is why source IDs matter.

---

# 42. Memory search

Natural language:

> “John ne budget ke bare mein kya kaha tha?”

> “Kaun se prospects ne January mein contact karne ko kaha?”

> “Humne kis kis ko proposal bhejne ka promise kiya?”

> “GreenScape ka current CRM kya hai?”

> “Kaun se companies Jobber use karti hain?”

> “Which memories need revalidation?”

---

# 43. Memory Search Result

Example:

```text
QUERY

Who asked us to contact them in January?

RESULTS

17 prospects

John / GreenScape
Requested Jan follow-up
Source: Email, Aug 4

Sarah / ABC Landscaping
Requested after Jan 10
Source: Meeting, Sep 12
```

Click → evidence.

---

# 44. Memory filters

```text
ENTITY
Company
Person
Opportunity

TYPE
Fact
Preference
Objection
Question
Promise
Requirement
Decision maker

STATUS
Active
Stale
Conflict
Needs Review
Invalidated

CONFIDENCE
High
Medium
Low

SOURCE
Conversation
Meeting
Website
Research
Human Note
```

---

# 45. Memory health

Global:

```text
MEMORY HEALTH

Fresh               82%
Stale                11%
Conflicting           2%
Needs Verification    5%
```

But percentages aren't enough.

Show impact:

```text
37 stale memories currently affect
active opportunities.

[Review]
```

---

# 46. Revalidation Queue

Prioritize:

```text
HIGH

Decision maker
Active opportunity

HIGH

Pricing-related company fact
Proposal stage

MEDIUM

Website technology
Cold prospect

LOW

Old review count
Dormant lead
```

Revalidation spend goes where value is.

---

# 47. Memory Revalidation Agent

Workflow:

```text
STALE MEMORY
     ↓
Can public/reliable source revalidate?
     ↓
YES → Research
     ↓
Same?
Update checked date
     ↓
Changed?
Create new current fact
Preserve history
```

If cannot verify:

```text
Status:
Unknown / stale
```

Never fabricate freshness.

---

# 48. Relationship milestones

System remembers meaningful events:

```text
First Contact
First Reply
First Meeting
First Proposal
First Purchase
Referral
Renewal
Expansion
Lost Deal
Re-engagement
```

Relationship timeline becomes much more useful than generic activity log.

---

# 49. Customer memory

When prospect becomes customer:

```text
PROSPECT MEMORY
       ↓
CUSTOMER RELATIONSHIP MEMORY
```

Don't reset context.

Preserve:

```text
Original need
What was sold
Important requirements
Promises
Stakeholders
Previous objections
Communication preferences
```

Useful for expansion/referral later.

---

# 50. Memory + Campaign protection

Before campaign enrollment:

```text
CHECK MEMORY

Previous customer?
Active opportunity?
Unsubscribe?
Asked not to contact?
Contact later date?
Existing relationship?
Previous objection?
Recent conversation?
```

Campaign cannot ignore relationship history.

---

# 51. Memory + Conversation

Before AI replies:

```text
LOAD

Who is this?
What company?
What are they discussing?
What do we already know?
What have we promised?
What did they promise?
What questions remain?
What must not be claimed?
```

Then respond.

---

# 52. Memory + Meetings

Before meeting:

```text
Relationship memory
+
Opportunity memory
+
Questions
+
Objections
+
Promises
+
Stakeholders
```

→ pre-meeting brief.

After meeting → new memories extracted.

Closed loop.

---

# 53. Memory + Signals

Suppose memory says:

```text
No Website
```

Signal Engine detects:

```text
Website launched
```

Memory updates:

```text
OLD
No website

CURRENT
Website detected
```

Campaign targeting changes automatically.

---

# 54. Memory + Opportunities

Opportunity qualification fields should be backed by memory/evidence.

```text
TIMELINE
Before December

← Prospect statement
```

No duplicate manual databases.

---

# 55. Memory + Learning Engine

Individual memory:

```text
John objected to price.
```

Across many accounts:

```text
Price objections occurred 31 times.
```

Learning Engine analyzes aggregate patterns.

But it shouldn't expose one prospect's private context as a global “learning.”

---

# 56. Memory + Knowledge Base

Important distinction:

```text
MEMORY

What we know about
a company/person/deal.


KNOWLEDGE BASE

What our own company
knows/claims about products,
services, policies and processes.
```

Example:

```text
John uses Jobber
→ MEMORY

Our product integrates with Jobber
→ KNOWLEDGE BASE
```

Never mix them.

---

# 57. Memory + AI Sales Manager

Ask:

> “Anything important I'm forgetting?”

AI can surface:

```text
3 commitments due today.

2 prospects requested October follow-up.

1 active opportunity has conflicting
decision-maker information.

4 proposal-stage opportunities have
stale stakeholder data.
```

Very powerful daily use case.

---

# 58. Memory Quality Feedback

Each memory:

```text
[Correct]
[Outdated]
[Not Relevant]
[Wrong Entity]
```

Corrections improve extraction system.

---

# 59. Memory Audit

Every important change:

```text
MEMORY AUDIT

Created
AI Extraction
Oct 2

Source
Email #...

Modified
Human
Oct 3

Reason
Corrected role

Revalidated
Research Agent
Oct 10
```

Full traceability.

---

# 60. Memory retention

Not everything needs permanent storage.

Define retention by class:

```text
Critical commercial records
Long-term according to policy

Temporary inference
Shorter lifecycle

Raw AI processing artifacts
Limited retention

Suppression/compliance records
Policy-defined

Audit records
Policy-defined
```

Specific periods configurable according to business/legal requirements.

---

# 61. Data minimization

Core rule:

> **Store what improves legitimate business workflow, not everything AI can infer.**

Avoid unnecessary profiling.

Especially avoid storing speculative personal traits that have no legitimate sales purpose.

---

# 62. Memory Security

Sensitive memory should support:

```text
Encryption at rest
Access control
Audit access
Workspace isolation
Backups
Retention rules
Deletion workflows
```

This becomes important when we reach technical architecture.

---

# 63. Memory Context Preview

Very useful developer/debug feature:

```text
[View AI Context]
```

Shows:

```text
CONTEXT PROVIDED TO AI

✓ Current conversation summary
✓ John role
✓ Active opportunity
✓ Jobber usage
✓ Timeline
✓ Open commitment
✓ Approved pricing policy

NOT INCLUDED

✕ Old unrelated opportunity
✕ Other employee conversation
✕ Stale website fact
```

This will make debugging AI behavior dramatically easier.

---

# 64. “Why Did AI Remember This?”

Click memory:

```text
WHY STORED?

Type:
Commercial requirement

Used for:
Qualification
Meeting preparation
Opportunity management

Source:
Direct prospect statement

Retention:
Relationship lifecycle / policy
```

Explainable memory.

---

# 65. Memory Usage Log

For important actions:

```text
EMAIL SENT

Memories used:

• Owner role
• Current CRM
• Timeline
• Previous integration question
```

If something goes wrong, we can trace context.

---

# 66. Memory contamination protection

One of the most important technical requirements:

```text
Person A
Company A
Opportunity A
```

data must never accidentally enter:

```text
Person B
Company B
Opportunity B
```

Every memory needs strict entity scoping.

This should be tested heavily later.

---

# 67. Memory confidence downgrade

Suppose:

```text
Owner:
John

Last verified:
18 months ago
```

Instead of keeping HIGH forever:

```text
Current status:
Needs Revalidation
```

Temporal uncertainty matters.

---

# 68. Historical truth vs current truth

Example:

```text
2025
No website

2026
Website launched
```

Both can be true historically.

System shouldn't “correct” history.

It should understand:

```text
THEN
vs
NOW
```

This will also improve signal detection.

---

# 69. Memory Snapshot

At any historical date:

```text
WHAT DID WE KNOW
WHEN EMAIL WAS SENT?
```

System can reconstruct:

```text
Sep 10

Website:
None detected

Owner:
John

Reviews:
83

CRM:
Unknown
```

Excellent for audit and experiment reproducibility.

---

# 70. AI Memory dashboard final layout

```text
AI MEMORY
────────────────────────────────────────

┌───────────────────────────────────────┐
│ Memory Health                         │
│ Fresh / Stale / Conflict / Review     │
└───────────────────────────────────────┘

┌─────────────────┐ ┌───────────────────┐
│ Commitments     │ │ Revalidation      │
│ Due / Overdue   │ │ Queue             │
└─────────────────┘ └───────────────────┘

┌─────────────────┐ ┌───────────────────┐
│ Conflicts       │ │ Relationship      │
│                 │ │ Changes           │
└─────────────────┘ └───────────────────┘

┌───────────────────────────────────────┐
│ Natural Language Memory Search        │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│ Recent Important Memory Changes       │
└───────────────────────────────────────┘
```

---

# 71. Ultimate Memory Lifecycle

```text
EVENT
  ↓
EXTRACT
  ↓
IDENTIFY ENTITY
  ↓
CLASSIFY
  ↓
CHECK EXISTING MEMORY
  ↓
VERIFY / CONFIDENCE
  ↓
SAVE
  ↓
USE IN RELEVANT CONTEXT
  ↓
REVALIDATE
  ↓
UPDATE / SUPERSEDE
  ↓
PRESERVE HISTORY
  ↓
EXPIRE / INVALIDATE WHEN APPROPRIATE
```

# Screen #12 locked

Ab system ke paas **relationship continuity** bhi properly aa gayi.

Humare 12 core screens:

```text
01  Command Center
02  AI Sales Manager
03  Lead Hunter
04  Company + Prospect 360°
05  Conversations / AI Inbox
06  Campaigns + Outreach
07  Opportunities
08  Calendar + Meetings
09  Buying Signals
10  Analytics + Revenue Intelligence
11  Experiments + AI Learning
12  AI Memory + Relationship Intelligence
```

Ab next **Screen #13: Knowledge Base + Business Brain** hona chahiye.

Ye bahut critical hoga because isi se AI ko pata chalega **hum kya sell karte hain, pricing kya hai, kis claim ki permission hai, integrations kya hain, FAQs ke approved answers kya hain, competitors ke against kya kehna allowed hai, case studies kya hain, proposal content kya hai, aur kis situation mein AI ko “I don't know” keh kar human ko escalate karna hai.**

Yahi screen AI hallucination ko commercially control karne ke main layers mein se ek hogi.