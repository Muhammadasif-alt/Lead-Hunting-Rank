Bilkul. Ab **Screen #7: Opportunities / Intelligent Sales Pipeline** ko lock karte hain.

Ye traditional CRM pipeline se kaafi different hogi. Sirf cards ko `New → Contacted → Won` drag karna objective nahi hoga. System ko har opportunity ke liye pata hona chahiye:

**Deal kyun exist karti hai, kaun involved hai, kya confirmed hai, kya missing hai, kya blocker hai, next action kya hai, kis ki responsibility hai, aur AI ko ab kya karna chahiye.**

# Screen #7: Opportunities

Main screen:

```text
OPPORTUNITIES                         Pipeline Value: $XXX,XXX

[Pipeline] [Priority] [My Deals] [AI Attention] [Won/Lost]

─────────────────────────────────────────────────────────────

DISCOVERY          QUALIFIED          MEETING          PROPOSAL

GreenScape         Austin Lawn        ABC Landscape    NaturePro
$ TBD              $8K                $12K             $18K

🔥 High            ● Healthy          ⚠ Action Due     🔥 High
John / Owner       Sarah / Owner      Mike / CEO       John / Owner

Next:
Confirm need       Meeting Friday     Send proposal    Follow up
```

## 1. Pipeline stages

Default stages:

```text
NEW OPPORTUNITY
      ↓
DISCOVERY
      ↓
QUALIFIED
      ↓
MEETING
      ↓
SOLUTION / PROPOSAL
      ↓
NEGOTIATION
      ↓
WON
```

Alternative exits:

```text
NURTURE
LOST
DISQUALIFIED
CANCELLED
```

Stages configurable hongi, lekin backend mein semantic meaning bhi hoga. Sirf arbitrary labels nahi.

---

# 2. Opportunity ≠ Company

Ye rule lock hona chahiye.

```text
COMPANY
GreenScape Landscaping

├── Opportunity #1
│   Website Redesign
│
├── Opportunity #2
│   AI Lead Automation
│
└── Opportunity #3
    Local SEO
```

Ek company multiple services buy kar sakti hai.

Isliye:

**Company = relationship/account**

**Opportunity = specific potential commercial outcome**

---

# 3. Automatic Opportunity Creation

Har positive reply par opportunity create nahi hogi.

Example:

```text
Prospect:
"Can you send some examples?"

→ Interested conversation
→ NO opportunity yet
```

But:

```text
"We're actually looking for a new website
and want something done this quarter."

→ Commercial need detected
→ Opportunity candidate
```

Depending on policy:

```text
AUTO CREATE
```

ya:

```text
AI:
Potential opportunity detected.

[Create Opportunity]
```

---

# 4. Opportunity Card

Card ko useful banana hai:

```text
🔥 GREENSCAPE — AI LEAD AUTOMATION

Stage
QUALIFIED

Value
$8,000 estimated

Primary Contact
John Smith / Owner

Need
Confirmed ✓

Timeline
This quarter ✓

Decision Authority
Owner ✓

Budget
Unknown

Last Meaningful Activity
Today

NEXT ACTION
Book discovery meeting

Owner
Simon

AI Health
GOOD
```

Card dekh kar deal ka state samajh aa jaye.

---

# 5. Opportunity 360°

Opportunity open:

```text
GREENSCAPE
AI Lead Automation

QUALIFIED

─────────────────────────────────────

Potential Value        $8,000
Confidence             Data-based status
Owner                  Simon
Primary Contact        John Smith
Created                Sep 28
Last Activity          Today

NEXT BEST ACTION

Book technical discovery call.

Reason:
Need and timeline confirmed.
Prospect asked implementation questions.

[Book Meeting] [Open Conversation]
```

---

# 6. Deal Qualification

Fixed BANT-only system nahi.

Custom qualification framework:

```text
QUALIFICATION

Need
✓ CONFIRMED

Authority
✓ CONFIRMED

Timeline
✓ This Quarter

Budget
? UNKNOWN

Current Solution
✓ Manual process

Pain / Problem
✓ Slow inquiry response

Required Features
✓ Website chat
✓ Lead follow-up
? CRM integration

Decision Process
? UNKNOWN

Competition
? UNKNOWN
```

User apni business type ke hisaab se qualification schema change kar sakega.

---

# 7. Known vs Unknown

Ye especially important hai.

System clearly show kare:

```text
KNOWN                    UNKNOWN

✓ Need                   ? Budget
✓ Owner                  ? Other stakeholders
✓ Timeline               ? Decision process
✓ Current problem        ? Procurement requirements
```

AI ka objective blindly form complete karna nahi.

Woh conversation mein naturally useful missing information gather karega.

---

# 8. Qualification Evidence

Click:

```text
TIMELINE
This Quarter
```

Drawer:

```text
SOURCE

John Smith
Email
Oct 2

"We're hoping to have this running
before December."

AI interpretation:
Timeline = before December

Confidence:
HIGH
```

AI field invent nahi kar sakta.

---

# 9. Stakeholder Map

B2B deals ek contact tak limited nahi hoti.

```text
STAKEHOLDERS

John Smith
Owner
Decision Maker
Influence: HIGH
Status: Engaged

Sarah Smith
Partner
Possible Decision Maker
Influence: UNKNOWN
Status: Not Contacted

Mike
Operations
User / Influencer
Influence: MEDIUM
Status: Known
```

Relationship graph:

```text
                 John
                OWNER
                  │
          Decision Maker
                  │
       ┌──────────┴──────────┐
       │                     │
    Sarah                  Mike
   Partner               Operations
```

---

# 10. Missing Stakeholder Detection

Prospect:

> “I need to discuss this with my partner.”

AI detects:

```text
NEW STAKEHOLDER

Role:
Business Partner

Name:
Unknown

Potential decision influence:
Likely relevant

NEXT ACTION
Understand partner's role before proposal.
```

System prematurely mark deal as fully qualified nahi karega.

---

# 11. Deal Health

Traditional CRMs often ask salesperson to manually choose probability.

Hum evidence-based **Deal Health** use karenge:

```text
DEAL HEALTH
● HEALTHY

Positive signals

✓ Need confirmed
✓ Decision maker engaged
✓ Recent reply
✓ Meeting accepted
✓ Clear timeline

Risks

⚠ Budget unknown
⚠ Partner may be involved
```

No fake “87% chance to close” unless there is a properly validated model and sufficient data. Initially we should avoid artificial probability.

---

# 12. Deal Risk Engine

AI continuously detect kare:

```text
RISKS

⚠ No meaningful activity for 6 days

⚠ Proposal sent but not discussed

⚠ Decision maker not confirmed

⚠ Budget unknown

⚠ New stakeholder appeared

⚠ Prospect requested information
   we haven't provided
```

Risk severity:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

With evidence.

---

# 13. Stalled Deal Detection

Example:

```text
ABC LANDSCAPING

Stage
Proposal

Last meaningful prospect activity
11 days ago

Our last message
7 days ago

Pending commitment
Prospect said they would discuss internally.

AI STATUS
⚠ POSSIBLY STALLED
```

Then:

```text
RECOMMENDED ACTION

Do not send generic "checking in."

Instead:
Reference previous decision discussion
and ask whether priorities changed.
```

---

# 14. Next Best Action

Every open opportunity should ideally have exactly one clear current next action.

Examples:

```text
WAIT FOR PROSPECT

SEND CASE STUDY

ANSWER TECHNICAL QUESTION

BOOK MEETING

PREPARE PROPOSAL

HUMAN FOLLOW-UP

IDENTIFY DECISION MAKER

RESEARCH COMPANY CHANGE

CLOSE AS LOST

MOVE TO NURTURE
```

And always:

```text
WHY?
```

---

# 15. No-Action Detection

System detects:

```text
⚠ OPPORTUNITY HAS NO NEXT ACTION

Proposal sent yesterday.

No follow-up plan exists.

[Create Next Action]
```

AI can automatically create routine follow-up according to policy.

---

# 16. Commitments Tracker

Two sides:

```text
OUR COMMITMENTS

✓ Send case study
  Completed Oct 1

⚠ Send custom proposal
  Due Today


PROSPECT COMMITMENTS

○ Review proposal with partner
  Expected Friday

○ Send current CRM details
  Pending
```

This should be first-class data, not buried in notes.

---

# 17. Meeting History

```text
MEETINGS

Discovery Call
Oct 3
Completed

AI Summary available ✓

Technical Demo
Oct 8
Scheduled

Proposal Review
Not scheduled
```

Click completed meeting:

```text
MEETING SUMMARY

Need
Improve lead response

Current process
Manual

Main concern
Integration

Timeline
Before December

Stakeholders
John + partner

Next step
Technical demo

Promises
Send integration details
```

---

# 18. Post-Meeting Intelligence

After meeting, system should extract:

```text
NEW FACTS
NEW REQUIREMENTS
NEW OBJECTIONS
NEW STAKEHOLDERS
NEW COMMITMENTS
NEW TIMELINE
NEXT ACTION
```

Human reviews uncertain/high-impact extractions.

---

# 19. Proposal Center

Opportunity:

```text
PROPOSAL

Status
DRAFT

Version
v1

Services
Website
AI Chat
Lead Automation

Pricing
Requires approval

[Generate Draft]
[Review]
```

AI can generate proposal content from approved knowledge and opportunity context.

But pricing authority follows global policy.

---

# 20. Proposal Lifecycle

```text
DRAFT
  ↓
INTERNAL REVIEW
  ↓
APPROVED
  ↓
SENT
  ↓
VIEWED / ACKNOWLEDGED
  ↓
DISCUSSION
  ↓
ACCEPTED / REJECTED
```

Where provider capabilities allow those signals.

---

# 21. Proposal Version Control

Never overwrite silently.

```text
PROPOSAL HISTORY

v1
$8,000
Sent Oct 4

v2
$9,500
Added integration
Sent Oct 7
```

System knows what prospect actually received.

---

# 22. Pricing Guardrails

Opportunity panel:

```text
PRICING AUTHORITY

Standard pricing        AI can explain
Approved package        AI can send if configured
Custom pricing          Human approval
Discount                Human approval
Payment terms           Human approval
Contract modification   Human approval
```

No autonomous “sure, we'll do 30% off.”

---

# 23. Objection Center

Deal-specific objections:

```text
OBJECTIONS

Existing Provider
Status: Resolved

Price
Status: Active

Integration Concern
Status: Active
```

Click:

```text
INTEGRATION CONCERN

Prospect:
"Will this work with our existing system?"

Status
OPEN

Owner
Technical Sales

Next action
Confirm integration capability.
```

---

# 24. Blockers

Objection and blocker separate.

```text
CURRENT BLOCKERS

1. Technical compatibility
2. Partner approval
```

Once cleared:

```text
RESOLVED BLOCKERS

✓ Website ownership/access
✓ Timeline
```

---

# 25. AI Deal Coach

Right side:

```text
AI DEAL COACH

What matters now?

1. Integration is the primary unresolved issue.

2. Partner appears to have decision influence
   but has not joined a conversation.

3. Prospect wants implementation before December.

Recommended:
Resolve technical compatibility before
pushing proposal discussion.
```

This is actionable, evidence-based coaching.

---

# 26. Ask Opportunity AI

Natural-language:

> “Is deal mein blocker kya hai?”

> “John ne pricing ke bare mein kya kaha?”

> “Proposal ke baad kya hua?”

> “Kis stakeholder se baat nahi hui?”

> “Humne kya promise kiya?”

> “Next best action kya hai aur kyun?”

> “Catch me up.”

AI uses only relevant opportunity/account context.

---

# 27. Opportunity Timeline

Complete history:

```text
SEP 21
Business discovered

SEP 23
Owner identified

SEP 24
First outreach

SEP 25
John replied

SEP 27
Need confirmed

SEP 29
Opportunity created

OCT 01
Discovery meeting

OCT 02
Technical concern raised

OCT 03
Proposal draft created
```

Sales journey visible end-to-end.

---

# 28. Source Attribution

Opportunity knows:

```text
ORIGIN

Market
Austin Landscapers

Lead Source
Geo Market Exhaust

Original Signal
No online lead capture

Campaign
Austin Lead Automation #3

Message Variant
B

First Engaged Contact
John Smith

Original Offer
AI Lead Automation
```

When won:

```text
Revenue:
$12,000
```

we can trace it all the way back.

---

# 29. Pipeline Priority View

Kanban ke ilawa:

```text
AI PRIORITY

🔥 Needs Action Now

ABC Landscaping
Proposal requested
Waiting on us 4 hours

GreenScape
Technical question
Waiting on us 1 hour


⚠ At Risk

NaturePro
No response after proposal

Texas Turf
Decision maker unclear


⏳ Waiting

Austin Lawn
Prospect reviewing proposal
```

This view may be more useful than standard pipeline.

---

# 30. My Work View

For each salesperson:

```text
MY OPPORTUNITIES

TODAY

3 human replies needed
2 meetings
1 proposal due
2 follow-ups
1 overdue commitment

PIPELINE

12 active opportunities
4 qualified
3 proposal
2 negotiation
```

AI handles background work.

---

# 31. Team Pipeline

Owner/Admin:

```text
TEAM

Simon
12 active
$XX pipeline
3 needs attention

Alex
8 active
$XX pipeline
1 needs attention

AI
31 conversations progressing
4 awaiting human
```

AI treated as execution layer, not fake employee with arbitrary quotas.

---

# 32. Opportunity Search

Natural language:

> “Show proposal-stage landscapers that haven't replied for 7 days.”

> “Show opportunities where budget is unknown.”

> “Show deals waiting on us.”

> “Show opportunities with owner engaged but no meeting.”

> “Show all deals with technical objections.”

Instant filtered view.

---

# 33. Pipeline Automation

Example:

```text
Meeting completed
      ↓
Qualification updated
      ↓
Need confirmed
Authority confirmed
Timeline confirmed
      ↓
AI proposes:
Move Discovery → Qualified
```

Low-risk stage changes may be automatic depending on settings.

High-impact transitions can require human approval.

---

# 34. Won Workflow

Deal becomes:

```text
WON
```

System:

```text
✓ Stop prospecting outreach
✓ Stop sales follow-ups
✓ Update company lifecycle
✓ Record revenue
✓ Preserve relationship memory
✓ Mark active customer
✓ Prevent cold campaign enrollment
✓ Record winning campaign/source
✓ Start configured handoff
```

Then:

```text
SALES → CUSTOMER HANDOFF
```

Future expansion can connect onboarding/service delivery.

---

# 35. Won Intelligence

AI asks structured questions from evidence:

```text
WHY DID THIS DEAL CLOSE?

Source
Geo Market Exhaust

Initial opportunity
Weak lead capture

Persona
Owner

Strongest buying need
Faster inquiry response

Key objection
Integration

Sales cycle
18 days

Revenue
$12,000
```

This feeds Learning Engine.

---

# 36. Lost Workflow

When lost:

```text
LOST REASON

○ Price
○ Timing
○ Competitor
○ No Budget
○ No Need
○ Internal Decision
○ No Response
○ Technical Fit
○ Wrong Prospect
○ Other
```

But AI can propose reason based on conversation:

```text
AI detected likely reason:
Timing

Evidence:
"We're putting this off until next year."

[Confirm]
```

---

# 37. Lost ≠ Dead Forever

Example:

```text
LOST
Reason: Timing

Prospect:
"Maybe revisit Q1."
```

System:

```text
RE-ENGAGEMENT
January

Status:
Nurture
```

January:

```text
Refresh account
Refresh stakeholders
Refresh need/signals
Check prior context
```

Then determine whether re-engagement still makes sense.

---

# 38. Negative Learning

Suppose repeated losses show:

```text
Very small companies
+ no established activity
+ generic inbox only
```

rarely convert.

AI Sales Manager can surface:

```text
OBSERVATION

This segment has produced:
High research cost
Low qualified engagement
No won opportunities

Recommendation:
Review ICP criteria.

[Analyze]
```

It doesn't silently blacklist a whole segment.

---

# 39. Pipeline Bottleneck Intelligence

Owner asks:

> “Sales slow kyun hai?”

AI may show:

```text
PIPELINE BOTTLENECK

Lead Discovery
Healthy

Reply Generation
Healthy

Qualification
Healthy

Meeting Booking
Healthy

Proposal → Decision
WEAK

Observed issue:
9 proposals currently waiting longer
than historical baseline.
```

Then investigate reasons.

---

# 40. Stage Aging

```text
STAGE AGE

Discovery
Average: 3 days

Qualified
Average: 4 days

Proposal
Average: 9 days

Negotiation
Average: 6 days
```

Specific:

```text
⚠ GreenScape has been in Proposal
for 17 days.
```

---

# 41. Revenue Forecasting

Important distinction: system can show factual pipeline amounts and external/validated model outputs, but shouldn't invent certainty.

Initially:

```text
OPEN PIPELINE VALUE
$120,000

CONFIRMED PROPOSALS
$47,000

WON THIS MONTH
$28,000
```

Later, if we build a validated forecasting model, show it explicitly as a model estimate with methodology/confidence rather than fake certainty.

---

# 42. Revenue Attribution

Won $12k:

```text
REVENUE ATTRIBUTION

Revenue
$12,000

Country
USA

Market
Austin

Industry
Landscaping

Discovery
Market Exhaust

Signal
Weak lead capture

Campaign
Austin Automation

Persona
Owner

Message Variant
B

Conversation Agent
AI + Human

Meeting Owner
Simon
```

Now system knows what actually produced money.

---

# 43. Expansion Opportunity

Existing customer later:

```text
GreenScape

Purchased:
Website + AI Chat

Potential:
Review Automation
CRM
Missed Call Automation
```

System can create:

```text
EXPANSION OPPORTUNITY
```

without treating them as a cold lead.

---

# 44. Referral Intelligence

Customer:

> “My friend owns another landscaping company.”

System:

```text
REFERRAL SIGNAL

New Company
Unknown / provided name

Introduced by
John / GreenScape

Relationship
Warm referral

[Create Referral Prospect]
```

Source attribution remains referral.

---

# 45. Opportunity Dependencies

Some deals require tasks:

```text
BEFORE PROPOSAL

✓ Discovery complete
✓ Requirements captured
⚠ Technical feasibility pending
○ Pricing approval
```

Proposal cannot auto-send until required gates pass.

---

# 46. AI Deal Autopilot

Per opportunity:

```text
AUTOPILOT

● ON

AI may:
✓ Schedule routine follow-ups
✓ Answer approved questions
✓ Update qualification
✓ Update memory
✓ Book meetings
✓ Create tasks
✓ Summarize meetings

AI must ask:
⚠ Pricing exception
⚠ Proposal approval
⚠ Discount
⚠ Contract
⚠ Legal
```

Autonomy can be changed deal-by-deal.

---

# 47. Deal Room

For high-value opportunities, one workspace:

```text
DEAL ROOM

Company
People
Conversations
Meetings
Requirements
Proposal
Files
Objections
Tasks
Commitments
Timeline
AI Coach
```

No need to jump across ten CRM screens.

---

# 48. Opportunity Notifications

Don't notify:

```text
Prospect opened email.
```

Do notify:

```text
🔥 Prospect requested proposal

🔥 Pricing exception requested

⚠ Commitment due today

⚠ High-value deal stalled

🔥 Meeting requested

⚠ Contract question requires human
```

Signal over noise.

---

# 49. Pipeline Command Bar

Top:

```text
Ask Pipeline AI...
```

Commands:

> “Show me what needs attention today.”

> “Which proposals are stalled?”

> “Which deals are waiting on us?”

> “Which opportunities have no next action?”

> “Show all deals where owner is engaged.”

> “Why did we lose landscaping deals?”

> “Show revenue originating from Austin Market Exhaust.”

This makes pipeline conversational.

---

# 50. Ultimate Opportunity Lifecycle

```text
LEAD HUNTER
      ↓
PROSPECT
      ↓
CAMPAIGN
      ↓
CONVERSATION
      ↓
COMMERCIAL NEED
      ↓
OPPORTUNITY
      ↓
QUALIFICATION
      ↓
STAKEHOLDERS
      ↓
MEETING
      ↓
REQUIREMENTS
      ↓
PROPOSAL
      ↓
OBJECTIONS / BLOCKERS
      ↓
NEGOTIATION
      ↓
WON / LOST / NURTURE
      ↓
REVENUE ATTRIBUTION
      ↓
LEARNING ENGINE
      ↓
BETTER ICP + BETTER PROSPECTING
```

## Screen #7 locked

Ab ek aur major product principle officially lock ho gaya:

**CRM history store karega, lekin AI sirf history summarize nahi karega. AI continuously identify karega ke deal ko aage move karne ke liye next required action kya hai.**

Aur har AI decision ke peeche **evidence, confidence, policy aur audit trail** available hoga.

### Next: Screen #8

Ab **`Calendar + Meetings Intelligence`** par jana chahiye.

Us screen mein hum normal appointment calendar se aage define karenge: **automatic scheduling, correct salesperson routing, timezone handling, qualification-based meeting types, conflict prevention, reminders, no-show handling, pre-meeting research brief, meeting notes/transcript ingestion, post-meeting extraction, commitments, next actions aur pipeline auto-update.**