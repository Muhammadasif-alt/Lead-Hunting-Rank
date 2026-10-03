Bilkul. Ab **Screen #8: Calendar + Meetings Intelligence** ko lock karte hain.

Ye sirf calendar nahi hoga. Iska kaam hoga:

> **Meeting intent detect karna → correct person/time select karna → booking → preparation → meeting outcome → follow-up → pipeline update.**

# Screen #8: Calendar + Meetings Intelligence

## 1. Main Calendar Screen

```text
CALENDAR & MEETINGS
────────────────────────────────────────────────────────

[Today] [Week] [Month] [Meetings] [Needs Action]

October 2026

09:00   GreenScape
        Discovery Call
        🔥 High Opportunity

11:30   Austin Lawn Co
        Website Consultation
        ✓ Qualified

14:00   ABC Landscaping
        Proposal Review
        ⚠ Pricing Decision

16:30   Texas Turf
        AI Automation Demo
        👤 Simon + Technical
```

Right side:

```text
TODAY

Meetings                 4
Qualified                3
High Priority            2
Prep Required            1
Follow-ups Due           2

NEXT MEETING

GreenScape
in 42 minutes

[Open Brief]
```

---

# 2. Meeting Types

Admin configurable meeting types:

```text
MEETING TYPES

Discovery Call
30 minutes

Technical Demo
45 minutes

Website Consultation
30 minutes

Proposal Review
30 minutes

Closing / Decision Call
30 minutes

Customer Onboarding
60 minutes
```

Each meeting type has rules.

Example:

```text
DISCOVERY CALL

Duration                 30 min
Required qualification   Basic
Assigned team             Sales
Buffer                    15 min
AI booking                Allowed
Video link                Auto
Pre-meeting brief         Yes
Reminder                  Yes
```

---

# 3. AI Scheduling From Conversation

Prospect:

> “Thursday afternoon works for me.”

AI doesn't immediately invent a time.

Flow:

```text
MEETING INTENT
      ↓
Identify prospect timezone
      ↓
Determine meeting type
      ↓
Determine correct salesperson
      ↓
Check calendars
      ↓
Apply availability rules
      ↓
Apply buffers
      ↓
Find valid slots
      ↓
Offer slots
```

Example:

```text
AVAILABLE THURSDAY

1:00 PM
2:30 PM
4:00 PM
```

AI sends only genuinely available slots.

---

# 4. Timezone Intelligence

Company:

```text
Austin, Texas
```

Prospect likely local business timezone.

But system stores:

```text
PROSPECT TIMEZONE
America/Chicago

Source:
Business location

Confidence:
High
```

If ambiguous:

> “Just to confirm, are you referring to Central Time?”

No silent dangerous assumption.

---

# 5. Team Availability

Each salesperson:

```text
SIMON

Working Hours
Mon–Fri
9:00 AM – 5:00 PM

Meeting Hours
10:00 AM – 4:00 PM

Maximum meetings/day
5

Minimum buffer
15 minutes

Lunch
12:30 – 1:30

Unavailable
Friday afternoon
```

Calendar respects these rules.

---

# 6. Smart Routing

Not every meeting goes to same salesperson.

Routing engine:

```text
ROUTING FACTORS

Territory
Industry
Service required
Opportunity size
Technical complexity
Language
Existing account owner
Previous relationship
Availability
Meeting type
Team workload
```

Example:

```text
GreenScape

Needs:
Website + AI automation

Opportunity:
High

Existing Owner:
Simon

ROUTED TO:
Simon

Technical specialist:
Optional
```

---

# 7. Relationship Continuity

If John has been speaking to Simon:

```text
Existing relationship:
Simon
```

AI shouldn't randomly book Alex just because Alex has an earlier slot.

Priority:

```text
Relationship Owner
      ↓
Qualified Backup
      ↓
Round Robin
```

unless business rules say otherwise.

---

# 8. Round Robin

For generic inbound:

```text
ROUND ROBIN

Simon     3 meetings today
Alex      1 meeting
Mike      2 meetings

Eligible:
Alex

→ Route to Alex
```

But availability alone isn't enough. Skill/territory rules still apply.

---

# 9. Qualification-Based Booking

Some meeting types may require:

```text
Need confirmed        ✓
Company fit           ✓
Correct persona       ✓
Valid business        ✓
```

If low-quality prospect:

```text
BOOKING RULE

Technical Demo requires:
Qualified Opportunity

Current:
Not Qualified

AI Action:
Continue qualification first.
```

This protects team calendars.

---

# 10. Meeting Request Card

When prospect asks for meeting:

```text
🔥 MEETING REQUEST

John Smith
GreenScape Landscaping

Intent
Strong

Opportunity
AI Lead Automation

Qualification
4 / 5

Requested
Thursday afternoon

Timezone
Central

Recommended Meeting
Discovery Call

Recommended Owner
Simon

[Auto Schedule]
[Review]
```

---

# 11. Booking Confirmation

Once prospect chooses:

```text
MEETING CONFIRMED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GreenScape Landscaping

Discovery Call

Thursday
October 8

2:30 PM CT

Duration
30 minutes

Salesperson
Simon

Prospect
John Smith

Video Meeting
Created ✓

Calendar Event
Created ✓
```

Then automatically:

```text
✓ Cold campaign stopped
✓ Opportunity updated
✓ Conversation state updated
✓ Meeting added to timeline
✓ Reminders scheduled
✓ Pre-meeting research scheduled
```

---

# 12. Calendar Conflict Protection

Before booking:

```text
CHECKS

Calendar availability      ✓
Buffer                      ✓
Working hours               ✓
Meeting limit               ✓
Existing booking            ✓
Timezone                    ✓
Team availability           ✓
```

If another system books same slot before confirmation:

```text
SLOT NO LONGER AVAILABLE

Do not double-book.

Find next available slots.
```

---

# 13. Temporary Slot Holds

During scheduling:

```text
2:30 PM

Temporary hold:
5 minutes
```

Useful when supported by calendar architecture.

Prevents two prospects selecting same slot simultaneously.

---

# 14. Rescheduling

Prospect:

> “Can we move this to Friday?”

AI:

```text
RESCHEDULE REQUEST

Current:
Thursday 2:30 PM

Requested:
Friday

Available:
10:30
1:00
3:30

[AI Handle]
```

Old event updated only after new slot confirmed.

No duplicate meetings.

---

# 15. Cancellation

Prospect:

> “Need to cancel.”

System:

```text
MEETING CANCELLED

Reason:
Prospect request

Opportunity:
Remain active

Next Action:
Determine whether rescheduling is appropriate.
```

Cancellation ≠ automatically lost deal.

---

# 16. Reminder Engine

Configurable:

```text
REMINDERS

24 hours before
Email

2 hours before
Email

15 minutes before
Internal team notification
```

But don't spam prospect with five reminders.

---

# 17. Smart Reminder Content

Reminder:

```text
Tomorrow at 2:30 PM

GreenScape × Our Company

Discovery Call

Meeting link
...
```

Can include simple reschedule option.

---

# 18. No-Show Detection

Meeting time passes.

System checks available meeting/calendar outcome signals.

```text
MEETING STATUS

Possible No-Show
```

Human or integration confirms.

Then:

```text
NO-SHOW WORKFLOW

Do not mark Lost.

→ Send approved follow-up
→ Offer rescheduling
→ Update meeting history
→ Create next action
```

---

# 19. Repeated No-Shows

Example:

```text
NO-SHOW HISTORY

Oct 3    No-show
Oct 8    No-show
```

AI:

```text
RISK

Repeated meeting no-shows.

Recommendation:
Require prospect confirmation before
another calendar slot is reserved.
```

Configurable.

---

# 20. Pre-Meeting Research

Before every meaningful sales meeting, system automatically refreshes:

```text
Company
Decision makers
Website
Recent signals
Conversation
Qualification
Objections
Promises
Opportunity
Previous meetings
```

Not rely on 3-month-old research.

---

# 21. AI Meeting Brief

30–60 minutes before meeting:

```text
GREENSCAPE
DISCOVERY CALL

Today — 2:30 PM

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHO

John Smith
Owner

COMPANY

GreenScape Landscaping
Austin, Texas

WHY THEY ENGAGED

Interested in improving inquiry handling.

CURRENT NEED

Website lead capture
AI response automation

KNOWN

✓ Owner
✓ Need
✓ Timeline before December
✓ Existing website

UNKNOWN

? Budget
? Partner involvement
? Current CRM

QUESTIONS ASKED

• Pricing
• Integration
• Setup timeline

OBJECTIONS

Existing web provider

PROMISES

We promised:
Integration information

NEXT MEETING OBJECTIVE

Confirm technical requirements
and decision process.
```

Salesperson walks into call fully prepared.

---

# 22. “What Should I Ask?”

Meeting brief button:

```text
[Suggested Questions]
```

AI:

```text
SUGGESTED DISCOVERY AREAS

1. How are website inquiries currently handled?

Reason:
Lead response is the identified opportunity.

2. Which existing systems must integrate?

Reason:
Integration concern was raised.

3. Who besides John participates in approval?

Reason:
Partner was mentioned previously.
```

Not generic 30-question checklist.

---

# 23. Things Not to Ask Again

Very important:

```text
ALREADY KNOWN

✓ Business type
✓ Timeline
✓ John is owner
✓ Existing website provider
```

AI meeting brief:

> **Don't ask these again unless clarification is required.**

Makes sales experience feel intelligent.

---

# 24. Meeting Notes

During/after meeting:

```text
MEETING NOTES

[Human Notes]

or

[Import Transcript]
```

If meeting platform provides permitted transcript/data, system processes it.

---

# 25. Meeting Intelligence Pipeline

```text
MEETING
   ↓
Notes / Transcript
   ↓
Summary
   ↓
Extract Facts
   ↓
Extract Requirements
   ↓
Extract Stakeholders
   ↓
Extract Objections
   ↓
Extract Commitments
   ↓
Update Qualification
   ↓
Determine Next Action
   ↓
Update Opportunity
```

---

# 26. Post-Meeting Summary

```text
MEETING SUMMARY

Outcome
Positive discovery call

Need
Automate incoming website inquiries

Current Process
Manual response

Timeline
Before December

Decision Makers
John + business partner

Technical Requirement
Existing CRM integration

Budget
Not discussed

Main Concern
Implementation complexity

Next Step
Technical demo

OUR COMMITMENTS

Send integration overview

PROSPECT COMMITMENTS

Invite partner to demo
```

---

# 27. Extraction Confidence

Not everything transcript says becomes fact automatically.

```text
EXTRACTED FACT

Timeline:
Before December

Confidence:
HIGH


POSSIBLE FACT

Budget:
Approximately $10k

Confidence:
LOW

[Confirm]
```

High-impact uncertain data gets human review.

---

# 28. Meeting Outcome

Structured outcome:

```text
MEETING OUTCOME

● Advanced
○ No Change
○ Needs Follow-up
○ Nurture
○ Disqualified
○ Lost
```

AI can recommend, human can confirm where appropriate.

---

# 29. Automatic Pipeline Update

Example:

Before:

```text
DISCOVERY
```

Meeting confirms:

```text
Need ✓
Authority ✓
Timeline ✓
Fit ✓
```

AI:

```text
RECOMMENDED STAGE

QUALIFIED

Reason:
Required qualification criteria confirmed.

[Accept]
```

Or auto-update if policy allows.

---

# 30. Automatic Follow-Up Draft

After call:

```text
POST-MEETING FOLLOW-UP

Hi John,

Thanks for the conversation today.

Based on what we discussed...

Next:
• We'll send integration information.
• You'll invite your partner to the demo.
• Technical demo: Tuesday...

```

Generated only from actual meeting data.

No invented promises.

---

# 31. Commitment Automation

Meeting says:

> “I'll send you the integration document tomorrow.”

System:

```text
OUR COMMITMENT

Send integration document

Due:
Tomorrow

Owner:
Simon

Status:
OPEN
```

Tomorrow if not completed:

```text
⚠ COMMITMENT OVERDUE
```

This is much more useful than generic task reminders.

---

# 32. Meeting → Next Meeting

If call ends with:

> “Let's do a technical demo next Tuesday.”

AI can:

```text
NEXT MEETING

Technical Demo

Required attendees:
John
Partner
Technical specialist

Preferred:
Tuesday

[Find Slots]
```

No salesperson manual back-and-forth.

---

# 33. Multi-Person Meetings

Meeting can contain:

```text
EXTERNAL

John — Owner
Sarah — Partner

INTERNAL

Simon — Sales
Mike — Technical
```

Stakeholder graph updates based on actual attendance.

---

# 34. Meeting Attendance Intelligence

If partner was expected but didn't attend:

```text
EXPECTED

Sarah / Partner

ATTENDED
No / Unknown

Potential issue:
Important stakeholder may still need context.
```

This affects next action.

---

# 35. Meeting Timeline

Opportunity:

```text
MEETING JOURNEY

Discovery
Oct 3 ✓

Technical Demo
Oct 8 ✓

Proposal Review
Oct 12 ✓

Decision Call
Oct 17 Scheduled
```

Entire buying process visible.

---

# 36. Meeting Search

Natural-language:

> “Show today's meetings.”

> “Which meetings need preparation?”

> “Show meetings with high-value opportunities.”

> “Which discovery calls haven't been followed up?”

> “Show no-shows this month.”

> “Which meetings mentioned pricing?”

> “Which calls created new opportunities?”

---

# 37. Meeting Analytics

```text
MEETING INTELLIGENCE

Booked                  42
Completed               31
Rescheduled              5
Cancelled                3
No-show                  3

Discovery → Qualified
...

Meeting → Proposal
...

Proposal Review → Won
...
```

Actual conversion tracked.

---

# 38. Meeting Quality Intelligence

Instead of salesperson surveillance, analyze useful process outcomes:

```text
MEETING DATA QUALITY

Need captured            89%
Next action captured     94%
Stakeholders identified  71%
Commitments captured     92%
```

Helps improve process.

---

# 39. Meeting Learning

Across won deals AI may observe:

```text
OBSERVATION

Deals where the technical stakeholder
joined before proposal showed a different
progression pattern than those where they didn't.

Sample:
...

Confidence:
...
```

AI proposes process experiment, not universal truth.

---

# 40. Calendar Capacity Intelligence

AI Sales Manager can answer:

> “Agar outreach double kar dein to sales team handle kar sakti hai?”

System examines:

```text
Average meetings/week
Available meeting hours
Current team utilization
Expected scheduling demand
```

Then:

```text
CAPACITY

Current:
31 meetings/week

Configured practical capacity:
45

Remaining:
14 meeting slots

Potential constraint:
Tuesday–Thursday afternoons nearly full.
```

Useful before scaling campaigns.

---

# 41. Smart Availability

Instead of exposing every empty calendar slot:

```text
PREFERRED SALES WINDOWS

Tue–Thu
10 AM–4 PM
```

AI can preserve:

```text
Deep work blocks
Lunch
Internal meetings
Buffers
Maximum consecutive calls
```

---

# 42. Calendar Routing Failover

If Simon unavailable for 2 weeks:

```text
PRIMARY OWNER
Simon

Unavailable until:
Oct 17

POLICY

High-intent prospect:
→ Offer qualified backup salesperson

Existing sensitive negotiation:
→ Ask human
```

Relationship context matters.

---

# 43. Meeting Priority

Today:

```text
MEETING PRIORITY

🔥 1. GreenScape
High-value + decision maker

🔥 2. ABC Landscaping
Proposal decision

3. Austin Lawn
Discovery

4. Texas Turf
Initial consultation
```

Priority is evidence-based, not calendar order.

---

# 44. Late Preparation Alert

```text
⚠ MEETING IN 20 MINUTES

Pre-meeting brief incomplete.

Reason:
Company website refresh failed.

Available information:
Conversation + previous research.

[Open Existing Brief]
```

System transparently reports missing data.

---

# 45. Calendar Integrations Architecture

Provider-independent:

```text
CalendarProvider

getAvailability()
createEvent()
updateEvent()
cancelEvent()
getEvent()
listEvents()
```

So initial:

```text
Google Calendar
```

Later:

```text
Microsoft 365 / Outlook
Other providers
```

without rebuilding scheduling engine.

---

# 46. Video Meeting Abstraction

Similarly:

```text
MeetingProvider

createMeetingLink()
getMeetingMetadata()
getPermittedTranscript()
```

Potential providers later depending on integrations and permissions.

---

# 47. Privacy / Recording Controls

Meeting intelligence needs strict controls:

```text
TRANSCRIPT POLICY

Recording/transcript available?
Consent requirements satisfied?
Integration permission?
Storage policy?
Retention policy?
Team access?
```

System shouldn't silently record calls.

---

# 48. Calendar AI Assistant

Right side:

```text
ASK CALENDAR AI
```

Examples:

> “John ke liye Thursday afternoon ka slot find karo.”

> “Kal ki meetings brief karo.”

> “Kaun se prospects no-show hue?”

> “Simon ki next week capacity kitni hai?”

> “GreenScape ki technical meeting reschedule karo.”

Actions still go through permissions.

---

# 49. Calendar Dashboard

Top-level:

```text
THIS WEEK

Meetings Booked          38
Qualified Meetings       27
Completed                21
Upcoming                 17

Needs Preparation         4
Human Follow-up           3
No-show Follow-up         2
```

Again, **actionable information first**.

---

# 50. Complete Meeting Loop

```text
CONVERSATION
      ↓
MEETING INTENT
      ↓
QUALIFICATION CHECK
      ↓
MEETING TYPE
      ↓
ROUTING
      ↓
AVAILABILITY
      ↓
TIMEZONE
      ↓
BOOK
      ↓
CONFIRM
      ↓
REMIND
      ↓
REFRESH RESEARCH
      ↓
PRE-MEETING BRIEF
      ↓
MEETING
      ↓
NOTES / TRANSCRIPT
      ↓
AI EXTRACTION
      ↓
QUALIFICATION UPDATE
      ↓
COMMITMENTS
      ↓
FOLLOW-UP
      ↓
NEXT MEETING / PROPOSAL
      ↓
PIPELINE UPDATE
```

## Screen #8 locked

Ab ek important product principle aur lock:

> **Meeting booked hona end-goal nahi hai. Meeting ka context, outcome aur next action automatically sales intelligence mein convert hona chahiye.**

Is point tak hamara flow genuinely connected ho gaya:

**Lead Hunter → Company 360 → Campaign → Conversation → Opportunity → Meeting → back into Opportunity + Memory + Learning.**

### Next Screen #9: Buying Signals & Intent Intelligence

Ye particularly powerful hoga. Ismein system saved markets aur existing prospects ko continuously observe karega aur detect karega ke **kis business ko ab contact karne ki wajah bani hai**.

Examples: new service, hiring, expansion, leadership change, website launch/change, technology change, new location, increased business activity, requested follow-up date, old opportunity waking up, etc.

Aur sabse important: signal milna automatically email bhejne ke barabar nahi hoga. **Signal → evidence → relevance → opportunity hypothesis → score → action** pipeline hogi.