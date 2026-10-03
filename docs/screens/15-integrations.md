Bilkul. Ab **Screen #15: Integrations + Data Sources** ko lock karte hain.

Ye sirf “Connect Gmail” wali settings screen nahi hogi. Ye hamare Revenue OS ka **external nervous system** hoga.

Core principle:

> **Har external system ko provider abstraction ke through connect karna hai, uski health, permissions, cost, sync state aur failures visible hone chahiye. Kisi ek provider ke fail hone se poora Revenue OS fail nahi hona chahiye.**

# Screen #15: Integrations + Data Sources

Main screen:

```text
INTEGRATIONS & DATA SOURCES

[Overview] [Connected] [Data Sources] [Communication]
[Calendar] [Enrichment] [AI] [Webhooks] [Logs]

────────────────────────────────────────────────────

SYSTEM CONNECTIVITY

Connected                     9
Healthy                       7
Needs Attention               1
Disconnected                  1

DATA SYNC
● Healthy

────────────────────────────────────────────────────

⚠ NEEDS ATTENTION

Google Calendar
Token requires attention

Lead Provider B
Elevated failure rate

────────────────────────────────────────────────────

CONNECTED

Gmail               ● Healthy
Google Calendar     ⚠ Attention
OpenAI              ● Healthy
Lead Provider A     ● Healthy
Email Verification  ● Healthy
```

## 1. Integration categories

Integrations ko categories mein organize karenge:

```text
COMMUNICATION

Email
SMS — future
WhatsApp — future where supported
Phone — future
Website Chat


CALENDAR

Google Calendar
Outlook Calendar — future


LEAD DISCOVERY

Business discovery providers
Search/data providers
Directories/APIs
Approved business-data sources


ENRICHMENT

Company enrichment
People enrichment
Contact discovery
Email discovery


VERIFICATION

Email verification
Phone verification where supported


AI

LLM providers
Embedding providers
Optional specialized AI services


CRM / SALES

Internal CRM
External CRM migration/sync if needed


STORAGE

Object storage
Document storage


NOTIFICATIONS

Email
Slack — future
Other internal channels


AUTOMATION

Webhooks
Custom APIs
```

Provider availability can evolve without redesigning the product.

---

# 2. Integration Overview

User ko instantly pata chale:

```text
COMMUNICATION

Gmail
3 Mailboxes
Healthy


CALENDAR

Google Calendar
4 Calendars
1 Needs Attention


DATA

Lead Sources
4 Active

Enrichment
2 Active

Verification
1 Active


AI

Primary LLM
Healthy

Fallback
Configured / Not Configured
```

---

# 3. Connection Card

Every provider card:

```text
GMAIL

Status
● CONNECTED

Accounts
3

Last successful operation
2 min ago

Today
Sent: ...
Received: ...

Health
Good

Permissions
Mail read/write/send as configured

[Manage]
```

No secrets displayed.

---

# 4. Connection Lifecycle

Standard states:

```text
NOT CONNECTED
      ↓
CONNECTING
      ↓
CONNECTED
```

Additional:

```text
NEEDS AUTH
DEGRADED
RATE LIMITED
ERROR
PAUSED
DISABLED
```

This standardized model works across providers.

---

# 5. Gmail Integration

Initially email provider:

```text
GMAIL

CONNECTED ACCOUNTS

sales@company.com
john@company.com
alex@company.com
```

Each mailbox:

```text
sales@company.com

Status
Healthy

Outbound
Enabled

Inbound Sync
Enabled

Campaign Sending
Enabled

AI Replies
Enabled

Daily Limit
Configured

Assigned User
Simon
```

---

# 6. Mailbox Capabilities

Per mailbox:

```text
ALLOW

✓ Human emails
✓ AI approved replies
✓ Campaign outreach
✓ Follow-ups
✓ Meeting confirmations

RESTRICT

Custom categories if required
```

One mailbox can be:

```text
Conversation only
```

another:

```text
Outbound prospecting
```

---

# 7. Mailbox Sending Limits

```text
MAILBOX LIMITS

Daily outbound limit
...

Campaign limit
...

Minimum send gap
...

Allowed sending hours
...

Timezone
...
```

These become hard infrastructure constraints.

Campaign cannot bypass them.

---

# 8. Provider Limit vs Internal Limit

Distinguish:

```text
PROVIDER LIMIT

External API/provider restriction
```

from:

```text
OUR SAFETY LIMIT

Configured by admin
```

System always obeys stricter applicable constraint.

---

# 9. Mailbox Health

Per mailbox:

```text
MAILBOX HEALTH

Connection            HEALTHY
Provider Errors       LOW
Bounce Activity       NORMAL
Sending Load          NORMAL
Unsubscribe Activity  NORMAL
```

If health deteriorates:

```text
⚠ MAILBOX RISK

AI Action:
New campaign volume reduced/paused
according to policy.
```

---

# 10. Inbound Email Sync

Incoming email flow:

```text
GMAIL
  ↓
SYNC / EVENT
  ↓
MESSAGE NORMALIZATION
  ↓
IDENTITY RESOLUTION
  ↓
THREAD RESOLUTION
  ↓
CONVERSATION ENGINE
```

Inbound replies should enter Screen #5 automatically.

---

# 11. Outbound Email Flow

```text
CAMPAIGN / CONVERSATION
        ↓
POLICY CHECK
        ↓
SUPPRESSION CHECK
        ↓
MAILBOX SELECTION
        ↓
RATE LIMIT
        ↓
EMAIL PROVIDER
        ↓
SEND
        ↓
STORE PROVIDER ID
        ↓
EVENT LOG
```

Critical for idempotency.

---

# 12. Duplicate Send Protection

Before sending:

```text
SEND REQUEST

Idempotency Key
campaign/contact/message/version
```

If worker retries:

```text
Already sent?
YES

→ DO NOT SEND AGAIN
```

This requirement stays locked.

---

# 13. Email Failure Handling

```text
SEND
 ↓
Provider timeout
 ↓
Check delivery state
 ↓
Safe retry?
```

Never:

```text
Timeout
→ blindly send again
```

because original request may have succeeded.

---

# 14. Google Calendar Integration

Calendar card:

```text
GOOGLE CALENDAR

Connected Users
4

Calendars
6

Availability Sync
Healthy

Booking
Enabled

Event Updates
Enabled
```

---

# 15. Calendar Mapping

Per salesperson:

```text
SIMON

Primary Calendar
Simon Work

Busy Calendars

✓ Work
✓ Personal Busy Blocks

Booking Calendar
Simon Work

Timezone
...
```

Private event details do not need to be copied if only free/busy is required.

---

# 16. Calendar Permissions

Granular:

```text
READ AVAILABILITY
YES

CREATE EVENTS
YES

UPDATE AI-CREATED EVENTS
YES

DELETE EVENTS
Policy controlled

READ EVENT DETAILS
Only if needed/permitted
```

Least privilege principle.

---

# 17. Calendar Failure

If provider fails:

```text
⚠ CALENDAR UNAVAILABLE

AI may NOT invent availability.

Meeting auto-booking:
PAUSED

Existing conversations:
Continue

Human:
Can provide slots manually
```

Very important.

---

# 18. Calendar Double-Check

Before final booking:

```text
Proposed slot
      ↓
Recheck provider availability
      ↓
Still available?
      ↓
YES → Create event
NO → Find alternative
```

Never trust stale availability cache for final booking.

---

# 19. Lead Discovery Providers

Dedicated area:

```text
LEAD DISCOVERY

Provider A
● Healthy

Provider B
● Healthy

Search Provider
● Healthy

Business Directory Source
● Healthy
```

But Lead Hunter doesn't know vendor-specific implementation.

It asks abstraction:

```text
LeadProvider
```

---

# 20. LeadProvider Contract

Later architecture:

```text
searchCompanies()
findPeople()
getCompany()
getPerson()
```

Individual provider adapters implement these where supported.

Lead Hunter works with normalized results.

---

# 21. Source Capabilities

Provider detail:

```text
PROVIDER A

CAPABILITIES

Company Discovery       ✓
Person Discovery        ✓
Business Phone          ✓
Business Email          ✓
Website                 ✓
Social                  Partial
Technology              ✕
Reviews                 ✕
```

AI knows which source is useful for what.

---

# 22. Source Coverage

Track:

```text
AUSTIN LANDSCAPERS

Provider A
412 unique businesses

Provider B
287

Provider C
603

Overlap
...

Unique contribution
...
```

Eventually system learns provider usefulness.

---

# 23. Source Provenance

Normalized business:

```text
GREENSCAPE

NAME
Source A
Source B

PHONE
Source B

WEBSITE
Official website

OWNER
Provider C
Public professional source
```

Every field can have multiple sources.

---

# 24. Source Trust

Different source types have different reliability for different fields.

Example:

```text
Official company website
Strong for:
Services

Not necessarily authoritative for:
Current owner
```

Likewise directory may be stale.

Trust should be **field-specific**, not one provider score.

---

# 25. Source Conflict

```text
PHONE

Provider A
512-...

Provider B
737-...
```

System:

```text
CONFLICT

Do not overwrite blindly.

Resolve using:
Recency
Source type
Cross-validation
Manual review if necessary
```

---

# 26. Enrichment Providers

Separate from discovery:

```text
ENRICHMENT

Company Enrichment
People Enrichment
Contact Discovery
Technology Detection
Social Discovery
```

This lets us optimize cost.

---

# 27. Enrichment Waterfall

Rather than query every paid provider:

```text
NEED OWNER EMAIL
      ↓
Provider A
      ↓
Found + sufficient confidence?
      ↓
YES → STOP
NO
      ↓
Provider B
      ↓
...
```

Huge cost saving.

---

# 28. Provider Routing Rules

Example:

```text
OWNER DISCOVERY

1. Public company source
2. Provider A
3. Provider B

EMAIL

1. Existing verified internal data
2. Provider A
3. Provider B

VERIFY

Verification Provider
```

Configurable.

---

# 29. Cost Per Provider

Provider detail:

```text
PROVIDER A

This Month

Requests
12,481

Estimated/Recorded Cost
$...

Useful Results
...

Cost / Useful Record
$...
```

Feeds Revenue Intelligence.

---

# 30. Provider Budget

```text
MONTHLY BUDGET

Provider A
$500

Used
$347

Remaining
$153
```

At threshold:

```text
80%
Notify

100%
Stop non-critical requests
```

according to policy.

---

# 31. Cost-Aware Routing

Suppose:

```text
Provider A
Cheap
70% useful coverage

Provider B
Expensive
90%
```

System strategy:

```text
A first
↓
B only for unresolved high-value records
```

Not every lead deserves maximum-cost enrichment.

---

# 32. Verification Provider

Dedicated:

```text
EMAIL VERIFICATION

Provider
...

Status
Healthy

This Month
...

Results

Verified
Likely
Risky
Catch-All
Invalid
Unknown
```

Normalized statuses remain same even if provider changes.

---

# 33. Verification Freshness

```text
john@company.com

Verified:
6 months ago
```

Before high-volume campaign:

```text
Reverification required?
```

based on configured policy.

---

# 34. Verification Provider Failure

If unavailable:

```text
DO NOT automatically treat
unverified email as verified.
```

Possible action:

```text
Queue verification
Delay campaign
Use existing sufficiently fresh verification
```

depending policy.

---

# 35. Website Intelligence Sources

Website audit may use:

```text
Direct website fetch
Technology provider
Performance source
Internal parser
```

Normalized into:

```text
Website Status
Technology
Forms
Chat
Booking
Analytics
Conversion Features
```

---

# 36. Social Discovery

Supported public/business sources where permitted.

Data model:

```text
Platform
Profile URL
Business Match Confidence
Last Checked
Evidence
```

Do not assume same-name profile belongs to company.

---

# 37. Identity Resolution Layer

External data:

```text
GreenScape LLC
Green Scape Landscaping
Greenscape Austin
```

before CRM creation:

```text
ENTITY RESOLUTION
       ↓
Same business?
```

Signals:

```text
Domain
Phone
Address
Coordinates
Social
Owner
Name
```

This prevents duplicate database pollution.

---

# 38. OpenAI / LLM Provider

AI integration card concept:

```text
AI PROVIDER

Primary Provider
Connected

Status
Healthy

Usage
...

Estimated Cost
...

Latency
...

Error Rate
...
```

Actual model configuration later belongs largely to AI Control Center/System configuration rather than exposing secrets here.

---

# 39. LLM Provider Abstraction

Architecture:

```text
LLMProvider

generate()
generateStructured()
embed()
```

Business logic should not directly call vendor SDK everywhere.

This lets us evolve provider/model strategy later.

---

# 40. Model Routing

Different tasks may need different capability/cost profiles:

```text
CLASSIFICATION
Fast/low-cost model

DEEP RESEARCH SYNTHESIS
More capable model

MESSAGE DRAFTING
Approved model

COMPLEX SALES REASONING
More capable model
```

Actual routing policies Screen #17 mein control hongi.

---

# 41. AI Failure Handling

If AI provider unavailable:

```text
CLASSIFICATION
Queue/retry

OUTBOUND AI REPLY
Do not send unprocessed message

CAMPAIGN GENERATION
Pause affected work

HUMAN
Can continue manually
```

No garbage fallback.

---

# 42. Model Output Validation

External AI response:

```text
LLM
 ↓
Schema validation
 ↓
Policy validation
 ↓
Grounding validation where needed
 ↓
Application
```

Never trust raw model output as database command.

---

# 43. Embeddings / Search Provider

Knowledge Base and memory retrieval may use embeddings.

Integration status:

```text
VECTOR / EMBEDDING

Provider
...

Index Health
Healthy

Last indexing job
...

Documents indexed
...
```

But business source-of-truth remains PostgreSQL/document storage, not embedding vectors.

---

# 44. CRM Imports

Even though our own system is CRM, migration should support:

```text
CSV
Existing CRM export
Approved CRM API integrations
```

Import pipeline:

```text
IMPORT
 ↓
Map Fields
 ↓
Preview
 ↓
Deduplicate
 ↓
Validate
 ↓
Import
 ↓
Report
```

---

# 45. CSV Import

User uploads:

```text
companies.csv
```

Mapping:

```text
CSV                    OUR SYSTEM

Business Name     →    Company Name
Website           →    Website
Contact Name      →    Person
Email             →    Email
Stage             →    Opportunity Stage
```

Before commit show preview.

---

# 46. Import Duplicate Handling

```text
1,000 rows

New                714
Possible duplicates 92
Existing updates   164
Invalid             30
```

User chooses policy.

Never silently duplicate 1,000 CRM records.

---

# 47. Import Provenance

Every imported fact:

```text
Source:
CSV Import

Import:
October Migration

Imported:
Oct 2
```

Later corrections retain provenance.

---

# 48. Export

Admin should be able to export relevant company data:

```text
Companies
Contacts
Opportunities
Activities
Campaign results
Memory where appropriate
Analytics
```

Within permissions.

Avoid platform lock-in.

---

# 49. Webhooks

Developer/advanced area:

```text
WEBHOOKS

Inbound
Outbound
```

Example outbound events:

```text
company.created
prospect.qualified
reply.received
meeting.booked
opportunity.created
opportunity.won
```

---

# 50. Webhook Configuration

```text
WEBHOOK

Name
Won Opportunity

Event
opportunity.won

Endpoint
Configured URL

Status
Active

Secret
••••••••

Last Delivery
Success
```

Secrets never displayed after creation except controlled replacement.

---

# 51. Webhook Delivery Log

```text
EVENT
opportunity.won

STATUS
Failed

Attempts
3

HTTP
500

Next Retry
...
```

Manual:

```text
[Retry]
```

---

# 52. Webhook Security

Use:

```text
HTTPS
Signing secret
Timestamp
Signature
Replay protection
Rate limiting
```

Later technical spec.

---

# 53. Inbound Webhooks

Could support:

```text
Website lead
External form
Phone system event
Third-party workflow
```

Incoming payload:

```text
Validate
↓
Authenticate
↓
Normalize
↓
Deduplicate
↓
Create event
```

Never blindly trust webhook JSON.

---

# 54. API Keys / Credentials

Integration UI:

```text
API KEY

••••••••••••••

Created
...

Last Used
...

[Rotate]
[Revoke]
```

Never expose raw secrets in normal UI/logs.

---

# 55. Secret Storage

Later architecture requirement:

```text
Secrets
≠
normal database plaintext
```

Use secure encrypted secret handling.

Application logs must redact:

```text
API keys
OAuth tokens
Passwords
Authorization headers
```

---

# 56. OAuth Connections

For Gmail/Calendar etc.:

```text
CONNECT
  ↓
OAuth consent
  ↓
Callback
  ↓
Validate scopes
  ↓
Secure token storage
  ↓
Connection test
```

Refresh token lifecycle handled automatically.

---

# 57. Scope Visibility

Integration screen should clearly show:

```text
GOOGLE ACCOUNT

Permissions granted:

✓ Read required mail metadata/content
✓ Send email
✓ Calendar availability
✓ Create calendar events
```

depending actual requested scopes.

User knows what system can access.

---

# 58. Least Privilege

If system only needs calendar free/busy:

Don't request unnecessary:

```text
Entire Drive
Contacts
Unrelated Google data
```

Permissions stay minimal.

---

# 59. Connection Test

Every provider:

```text
[Test Connection]
```

Returns:

```text
Authentication     ✓
Permissions        ✓
API Access         ✓
Basic Operation    ✓
Latency            Normal
```

---

# 60. Integration Health Score

Don't rely on just:

```text
Connected ✓
```

Provider can be connected but unusable.

Dimensions:

```text
Authentication
API availability
Permissions
Rate limits
Recent failures
Latency
Sync freshness
```

Then:

```text
HEALTHY
DEGRADED
CRITICAL
```

---

# 61. Health Timeline

```text
GMAIL

09:00 Healthy
11:42 Rate limited
11:47 Recovered
14:10 Healthy
```

Useful for debugging.

---

# 62. Integration Incident

If provider fails:

```text
INCIDENT

Lead Provider A

Started
10:31

Impact
Company enrichment delayed

Affected Jobs
247

System action
Using fallback for high-priority leads

Human required
No
```

Only escalate if necessary.

---

# 63. Graceful Degradation

Example:

```text
ENRICHMENT PROVIDER DOWN
```

Should not stop:

```text
Inbox
Existing opportunities
Calendar
Human CRM access
```

Only affected capability degrades.

---

# 64. Circuit Breaker

If provider repeatedly fails:

```text
10 failures
 ↓
Circuit Open
 ↓
Stop hammering provider
 ↓
Wait
 ↓
Test
 ↓
Recover
```

Prevents cost/error storms.

---

# 65. Retry Policy

Provider-specific:

```text
Network timeout
Retry

401 authentication
Don't blindly retry

429 rate limit
Wait/retry

400 bad request
Fail + investigate
```

Smart retries.

---

# 66. Dead-Letter Queue

Jobs that exhaust retry:

```text
FAILED JOBS

Enrich Company
GreenScape

Reason
Provider timeout

Attempts
5

[Retry]
[Use Alternate Provider]
[Dismiss]
```

---

# 67. Provider Fallback

Example:

```text
PRIMARY
Provider A

FALLBACK
Provider B
```

But fallback policy considers:

```text
Cost
Capability
Confidence
Budget
Priority
```

Not automatic expensive waterfall for everything.

---

# 68. Source Priority Rules

Admin can define:

```text
WEBSITE

1 Official company website
2 Provider A
3 Provider B


OWNER

1 Verified company information
2 Approved professional source
3 Enrichment provider
```

This improves evidence quality.

---

# 69. Data Field Lineage

Company field:

```text
PHONE
512-555-...

CURRENT SOURCE
Company website

ALTERNATIVE SOURCES
Provider A
Directory B

Last checked
Oct 2
```

This is crucial for Company 360 evidence drawer.

---

# 70. Integration Data Mapping

External provider may return:

```text
employee_count
```

Another:

```text
company_size
```

Normalization:

```text
External schemas
      ↓
Provider Adapter
      ↓
Canonical Data Model
```

Rest of app doesn't care which provider produced it.

---

# 71. Canonical Data Model

Conceptually:

```text
Company
Person
ContactPoint
SourceEvidence
Signal
Conversation
Meeting
Opportunity
```

External data gets translated into these objects.

No vendor-shaped core database.

---

# 72. Raw Provider Response

Where useful and permitted:

```text
Normalized data
+
Raw provider reference/payload metadata
```

Raw response useful for debugging but should have appropriate retention/access controls.

---

# 73. Data Freshness Per Provider

```text
Provider A

Last successful sync
2 min ago

Oldest queued job
8 min

Pending
42

Failed
3
```

Operations visible.

---

# 74. Sync Types

```text
REAL-TIME / EVENT DRIVEN

Inbound email
Some webhooks


NEAR REAL-TIME

Calendar changes
Conversation events


SCHEDULED

Market rescan
Data refresh
Provider sync


ON-DEMAND

Deep Research
Reverification
```

Not everything should poll constantly.

---

# 75. Scheduler Visibility

```text
SCHEDULED JOBS

Austin Market Rescan
Every configured interval

Company Freshness
...

Knowledge Revalidation
...

Lost Deal Monitoring
...
```

Detailed schedule control can live in system settings later.

---

# 76. Rate Limit Manager

Centralized:

```text
PROVIDER A

Allowed
...

Currently used
...

Remaining
...

Reset
...
```

Worker system respects this globally.

---

# 77. Concurrency Limits

Provider may support only limited parallel operations.

```text
MAX CONCURRENT
10

ACTIVE
8

QUEUED
42
```

BullMQ later manages queues.

---

# 78. Priority Queue

High-value active opportunity:

```text
Research request
```

should outrank:

```text
Background refresh
of low-priority cold lead
```

Queues:

```text
CRITICAL
HIGH
NORMAL
BACKGROUND
```

---

# 79. Budget-Aware Queue

If enrichment budget nearly exhausted:

```text
HIGH VALUE
Continue

LOW VALUE
Delay

BACKGROUND
Pause
```

Business priority affects infrastructure consumption.

---

# 80. Integration Usage Analytics

```text
LAST 30 DAYS

Gmail
12,400 operations

Calendar
1,240

Lead Discovery
32,481

Enrichment
18,210

Verification
9,411

AI
...
```

Then cost/outcome analytics.

---

# 81. Useful Result Rate

Provider:

```text
REQUESTS
10,000

Useful records
6,800

New unique businesses
2,400

Qualified businesses
700

Meetings eventually attributed
...
```

Much more useful than API request count.

---

# 82. Provider Performance Comparison

Internally:

```text
PROVIDER       COVERAGE    COST    QUALITY    LATENCY

A              ...
B              ...
C              ...
```

We don't need simplistic winner labels. Routing can be optimized based on specific use case.

---

# 83. Integration Audit Log

```text
AUDIT

Simon connected Gmail
Oct 2

Alex changed mailbox limit
Oct 3

System refreshed OAuth token
Oct 3

Simon disabled Provider B
Oct 4
```

Sensitive token values never logged.

---

# 84. Permission Changes

If provider scope changes:

```text
⚠ PERMISSION CHANGE

Google Calendar

Required permission missing:
Create Events

Impact:
AI booking disabled.
```

Precise impact shown.

---

# 85. Integration Dependencies

System knows:

```text
GMAIL DOWN

Affected:

Campaign Sending
Email Inbox Sync
AI Email Replies
Email Follow-ups
```

But:

```text
Lead Hunter
Calendar
Analytics historical data
```

may still operate.

---

# 86. Dependency Map

Visual:

```text
GMAIL
├ Campaigns
├ Conversations
└ Notifications

CALENDAR
├ Scheduling
├ Meetings
└ Availability

LEAD PROVIDERS
└ Lead Hunter

ENRICHMENT
├ Lead Hunter
├ Company 360
└ Signals

LLM
├ AI Sales Manager
├ Research
├ Conversations
├ Campaigns
└ Analytics
```

Great admin/debugging view.

---

# 87. Provider Maintenance Mode

Admin:

```text
[PAUSE PROVIDER]
```

Example:

```text
Provider B
Paused

New requests
Blocked

Existing data
Still usable according to freshness policy
```

---

# 88. Replace Provider

If Provider A is removed:

Core system shouldn't break.

```text
Provider A
      ↓
Disable adapter

Provider B
      ↓
Enable adapter
```

Lead Hunter continues using canonical interface.

This is why abstraction is locked from day one.

---

# 89. Integration Environment

Later deployment can distinguish:

```text
PRODUCTION
```

and optionally:

```text
TEST / SANDBOX
```

Test credentials shouldn't accidentally send real prospect emails.

---

# 90. Test Mode

Very important:

```text
SYSTEM TEST MODE

Outbound email
→ Test recipients only

Calendar
→ Test calendar

Campaign
→ No real send

Webhooks
→ Test endpoints
```

Essential during development.

---

# 91. Dry Run Integration Test

Before campaign:

```text
DRY RUN

Lead discovery         ✓
Enrichment             ✓
Verification           ✓
AI generation          ✓
Mailbox selection      ✓
Email policy           ✓

SEND
SKIPPED — DRY RUN
```

This connects with Campaign Screen #6.

---

# 92. Data Source Settings

Per source:

```text
ENABLED
YES

Allowed For
Lead Discovery
Research
Signals

Geographies
...

Industries
...

Cost Limit
...

Priority
...

Refresh Policy
...
```

Granular control.

---

# 93. Source Restrictions

If source terms or company policy prohibit certain usage:

```text
SOURCE

Allowed:
Research

Not allowed:
Automated contact enrichment
```

System must respect capability restrictions.

---

# 94. Source Evidence Storage

Every discovered fact:

```text
VALUE
Owner = John Smith

SOURCE
Provider A

SOURCE RECORD
Reference ID

CHECKED
Oct 2

CONFIDENCE
...
```

Later provider disappears? We still know where fact came from, subject to retention/licensing rules.

---

# 95. Integration Search

Natural language:

> “Kaun si integration unhealthy hai?”

> “Gmail mein koi problem hai?”

> “Lead Hunter kis kis source ko use kar raha hai?”

> “Is month enrichment par kitna spend hua?”

> “Calendar booking kyun paused hai?”

> “Provider B ke failed jobs dikhao.”

---

# 96. AI Integration Diagnostics

Example:

```text
WHY IS LEAD RESEARCH SLOW?

Observed:

Provider A
Normal

Provider B
Rate limited

Research queue
428

Current system action:
High-priority leads routed through A.
Background jobs delayed.
```

Useful operations assistant.

---

# 97. Human Attention Integration

Only actionable incident reaches Screen #14.

Example:

```text
CALENDAR AUTH EXPIRED

AI cannot fix authentication.

→ HUMAN ATTENTION
```

But:

```text
Provider timeout
Recovered after retry

→ LOG ONLY
```

No noise.

---

# 98. Global Integration Safety

Important rule:

> **External provider response is untrusted input.**

Whether:

```text
API
Webhook
Email
Website
CSV
```

everything passes:

```text
VALIDATION
NORMALIZATION
AUTHORIZATION
ENTITY RESOLUTION
POLICY
```

before affecting core system.

---

# 99. Integration Screen Final UX

```text
┌─────────────────────────────────────────────────────────┐
│ INTEGRATIONS                       System Health ●       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  CONNECTION HEALTH                                     │
│  9 Connected | 7 Healthy | 1 Warning | 1 Disabled     │
│                                                         │
├───────────────────┬─────────────────────────────────────┤
│ Categories        │ Integrations                        │
│                   │                                     │
│ Overview          │ Gmail                ● Healthy      │
│ Communication     │ Google Calendar      ⚠ Attention    │
│ Calendar          │ Lead Provider A      ● Healthy      │
│ Discovery         │ Enrichment           ● Healthy      │
│ Enrichment        │ Verification         ● Healthy      │
│ AI                │ AI Provider          ● Healthy      │
│ Webhooks          │                                     │
│ Logs              │                                     │
├───────────────────┴─────────────────────────────────────┤
│ Recent Incidents / Cost / Usage                         │
└─────────────────────────────────────────────────────────┘
```

---

# 100. Ultimate Integration Architecture

```text
EXTERNAL WORLD

Gmail
Calendar
Lead Sources
Enrichment
Verification
AI Providers
Webhooks
Future Channels
        │
        ▼
PROVIDER ADAPTERS
        │
        ▼
VALIDATION
        │
        ▼
NORMALIZATION
        │
        ▼
ENTITY RESOLUTION
        │
        ▼
CANONICAL DATA MODEL
        │
        ▼
EVENT SYSTEM
        │
        ▼
─────────────────────────────────
Lead Hunter
Company 360
Signals
Campaigns
Conversations
Calendar
Opportunities
Analytics
AI Memory
Knowledge
─────────────────────────────────
```

And outbound:

```text
SYSTEM DECISION
      ↓
POLICY
      ↓
PERMISSION
      ↓
BUDGET / LIMIT
      ↓
PROVIDER ADAPTER
      ↓
EXTERNAL PROVIDER
      ↓
RESULT
      ↓
EVENT + AUDIT
```

# Screen #15 locked

Ab **15 / 18 screens complete** hain.

Remaining:

```text
16  Team + Roles + Permissions
17  AI Control Center + Autonomy / Policies
18  Settings + System Administration
```

Ek architecture decision bhi Screen #15 ke saath officially lock samjho:

> **Gmail, Google Calendar, OpenAI ya kisi lead provider ko core business logic ke andar hard-code nahi karenge. Har external service adapter/provider layer ke peeche hogi.**

Is se kal ko Gmail ke saath Outlook, ek lead provider ke saath doosra provider, ya AI model/provider change karna ho to poora application rewrite nahi karna padega.