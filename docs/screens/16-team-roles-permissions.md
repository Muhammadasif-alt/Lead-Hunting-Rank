Bilkul. Ab **Screen #16: Team + Roles + Permissions** ko lock karte hain.

Ye system 4–5 internal users ke liye hai, isliye enterprise-style unnecessarily complex IAM nahi banayenge. Lekin permissions strong honi chahiye, kyun ke system ke paas email sending, prospect data, pricing, proposals, AI autonomy aur integrations jaisi powerful capabilities hongi.

Core principle:

> **Har user ko sirf utni authority mile jitni uske kaam ke liye zaroori hai. AI ki authority bhi ultimately kisi human-defined permission aur policy se aayegi.**

# Screen #16: Team + Roles + Permissions

Main screen:

```text
TEAM & ACCESS
────────────────────────────────────────────────────

[Team] [Roles] [Permissions] [Assignments]
[Approval Authority] [Activity]

TEAM

Active Users                 5
Pending Invites              1
Admins                       2
Sales                        2
Researchers                  1

────────────────────────────────────────────────────

TEAM MEMBERS

Simon
Owner
● Active

Alex
Sales
● Active

Mike
Admin
● Active

Sarah
Researcher
● Active
```

## 1. Five Core Roles

Initial system mein ye roles lock karenge:

```text
OWNER

Full business authority
System-level controls
Billing / critical settings
Security
AI autonomy
Pricing authority


ADMIN

Operational administration
Integrations
Campaign configuration
Knowledge management
Team management as permitted


SALES

Prospects
Conversations
Opportunities
Meetings
Assigned tasks
Approved campaign actions


RESEARCHER

Lead discovery
Research
Enrichment
Company intelligence
Data review


VIEWER

Read-only permitted information
```

Later custom roles possible honge.

---

# 2. Role ≠ Job Title

User ka job title:

```text
Sales Manager
```

ho sakta hai.

System role:

```text
ADMIN
```

Separate concepts.

---

# 3. Team Member Profile

Example:

```text
SIMON

Role
OWNER

Status
ACTIVE

Timezone
...

Assigned Markets
Austin
Dallas

Assigned Opportunities
12

Mailbox
simon@company.com

Calendar
Simon Work

AI Relationship
Primary Sales Owner
```

---

# 4. User Status

```text
INVITED
ACTIVE
SUSPENDED
DISABLED
```

Agar employee leaves:

```text
DISABLE USER
```

Instead of deleting historical identity.

Because old activity must still say:

```text
Proposal approved by Alex
```

even after Alex leaves.

---

# 5. Invite Flow

```text
[Invite Team Member]

Email
alex@company.com

Role
Sales

Initial Permissions
From Sales Role

Assigned Markets
Optional

[Send Invite]
```

Invite expiry/revoke support bhi hoga.

---

# 6. Permission Model

Permissions ko sirf page visibility tak limited nahi rakhenge.

Structure:

```text
RESOURCE
+
ACTION
+
SCOPE
```

Example:

```text
Opportunity
Edit
Assigned Only
```

versus:

```text
Opportunity
Edit
All
```

---

# 7. Permission Actions

Common actions:

```text
VIEW
CREATE
EDIT
DELETE / ARCHIVE
ASSIGN
APPROVE
SEND
EXPORT
MANAGE
ADMINISTER
```

Har resource ko har action ki zarurat nahi hogi.

---

# 8. Main Permission Domains

```text
PROSPECTING

Markets
Companies
People
Lead Hunter
Research
Enrichment


OUTREACH

Campaigns
Messages
Sequences
Sending


CONVERSATIONS

View
Reply
AI Takeover
Assign
Resolve


SALES

Opportunities
Pricing
Proposals
Meetings


INTELLIGENCE

Signals
Analytics
Experiments
Memory


BUSINESS BRAIN

Knowledge
Pricing Knowledge
Policies
Case Studies


SYSTEM

Integrations
Users
Roles
AI Controls
System Settings
Audit
Exports
```

---

# 9. Permission Matrix

UI concept:

```text
                    OWNER   ADMIN   SALES   RESEARCHER   VIEWER

Lead Hunter           ✓       ✓       ✓         ✓          View
Companies             ✓       ✓       ✓         ✓          View
Campaign Create       ✓       ✓       ✓         ✕           ✕
Send Outreach         ✓       ✓       ✓*        ✕           ✕
Conversations         ✓       ✓       ✓         Limited     View*
Opportunities         ✓       ✓       ✓         View*       View*
Pricing Change        ✓       ✕*      ✕          ✕           ✕
AI Autonomy           ✓       Limited ✕          ✕           ✕
Integrations          ✓       ✓*      ✕          ✕           ✕
Team Management       ✓       ✓*      ✕          ✕           ✕
```

`*` means configurable authority.

Exact defaults hum implementation se pehle permission matrix mein formally define karenge.

---

# 10. Scope Permissions

User ko access ho sakta hai:

```text
ALL
```

ya:

```text
ASSIGNED ONLY
```

ya:

```text
TEAM
```

ya:

```text
SPECIFIC MARKETS
```

Example:

```text
Alex

Companies:
Assigned Markets

Markets:
Austin
Dallas
```

---

# 11. Territory Access

Future larger team ke liye:

```text
SIMON
All Markets

ALEX
Texas

MIKE
California
```

But 4–5 user setup mein optional rakhenge.

No unnecessary complexity.

---

# 12. Opportunity Ownership

Opportunity:

```text
GreenScape
$18K

OWNER
Alex
```

Permissions can say:

```text
Sales can edit:
Assigned opportunities only
```

Manager/admin:

```text
All opportunities
```

---

# 13. Company Ownership

Company/account can have:

```text
ACCOUNT OWNER
Alex
```

This affects:

```text
New conversations
Opportunities
Tasks
Meetings
Expansion opportunities
```

Relationship continuity maintained.

---

# 14. Assignment Hierarchy

Concept:

```text
COMPANY OWNER
      ↓
OPPORTUNITY OWNER
      ↓
TASK OWNER
```

Opportunity can have different specialist where needed.

---

# 15. Campaign Ownership

Campaign:

```text
Austin Landscaping

OWNER
Alex

CREATED BY
Simon

AI MODE
Controlled
```

Campaign owner handles normal operations.

But global admin can intervene.

---

# 16. Conversation Assignment

Conversation can be:

```text
AI
```

or:

```text
Alex
```

or:

```text
Technical Team / Mike
```

Human takeover automatically sets responsible owner where appropriate.

---

# 17. Meeting Routing

Screen #8 uses team data:

```text
Salesperson

Skills
Territory
Availability
Relationship
Meeting Type
```

Example:

```text
TECHNICAL DEMO
→ Mike

DISCOVERY
→ Alex
```

---

# 18. Skills / Capabilities

Optional lightweight profile:

```text
MIKE

SKILLS

Technical Demo
Integrations
Automation
Advanced Implementation
```

Scheduling engine can use this.

Not HR profiling.

---

# 19. Language Capability

If relevant:

```text
Alex

English ✓
Spanish ✓
```

Meeting routing can consider it.

Only operationally relevant data.

---

# 20. Approval Authority

This deserves dedicated tab.

```text
APPROVAL AUTHORITY
────────────────────────────

Pricing
Proposal
Discount
Contract
Campaign
Experiment
Knowledge
AI Strategy
```

---

# 21. Pricing Authority

Example:

```text
OWNER

Standard pricing       ✓
Custom pricing         ✓
Discount               ✓


ADMIN

Standard pricing       ✓
Custom pricing         Review only
Discount               Up to configured limit


SALES

Standard pricing       Use approved
Custom pricing         Request approval
Discount               No authority
```

---

# 22. Monetary Authority

Instead of only role:

```text
Alex

Proposal Approval
Up to $10,000

Simon
Unlimited / owner authority
```

If:

```text
Opportunity
$18,000
```

Alex cannot final-approve if policy says $10k.

Attention Center routes it correctly.

---

# 23. Discount Authority

Example:

```text
Sales
0%

Admin
Up to configured %

Owner
Policy-defined maximum
```

AI remains separate:

```text
AI
Only explicitly approved discount rules
```

---

# 24. Contract Authority

```text
STANDARD CONTRACT

Admin
Can send approved version


CONTRACT MODIFICATION

Owner / designated human only
```

AI:

```text
Never independently modifies legal terms.
```

---

# 25. Proposal Authority

Possible workflow:

```text
AI
Draft

Sales
Review

Admin/Owner
Approve

AI
Send
```

Depending opportunity value.

---

# 26. Campaign Authority

Example:

```text
SALES

Create campaign       ✓
Edit own campaign     ✓
Launch                 Up to configured audience
Large launch           Approval
Global market          Approval
```

---

# 27. Campaign Size Threshold

```text
Alex

Auto-launch authority:
Up to 100 eligible prospects

Above:
Admin approval
```

This protects against accidental mass outreach.

---

# 28. AI Experiment Authority

```text
SALES

View experiments
Suggest idea


ADMIN

Approve low-risk experiment


OWNER

Approve high-impact strategy experiment
```

High-risk pricing/legal/compliance experiments remain tightly restricted.

---

# 29. Knowledge Authority

Different KB areas:

```text
GENERAL FAQ
Admin

TECHNICAL
Mike

PRICING
Simon

LEGAL / CONTRACT
Owner only
```

This maps naturally to Screen #13.

---

# 30. Knowledge Ownership

Article:

```text
Jobber Integration

KNOWLEDGE OWNER
Mike

APPROVER
Simon
```

If stale:

```text
Review assigned to Mike
```

---

# 31. Integration Permissions

Not every admin should automatically see/change every credential.

Actions:

```text
VIEW CONNECTION STATUS

CONNECT

RECONNECT

CHANGE SETTINGS

DISCONNECT

ROTATE CREDENTIAL

VIEW LOGS
```

Separate permissions.

---

# 32. Secrets Never Visible

Even Owner shouldn't normally see:

```text
Raw OAuth token
API secret after creation
```

Permission to manage integration does not mean permission to read secret material.

---

# 33. Export Permission

Very important:

```text
EXPORT COMPANIES
EXPORT CONTACTS
EXPORT CONVERSATIONS
EXPORT OPPORTUNITIES
EXPORT ANALYTICS
```

Could be:

```text
Owner/Admin only
```

because export is a major data-exfiltration capability.

---

# 34. Bulk Action Permission

Separate permission:

```text
Bulk Assign
Bulk Campaign Add
Bulk Archive
Bulk Export
Bulk Update
```

A user allowed to edit one prospect shouldn't automatically be allowed to alter 20,000.

---

# 35. Delete vs Archive

Most business objects:

```text
ARCHIVE
```

preferred over destructive delete.

Hard delete:

```text
Owner / system policy only
```

where appropriate.

---

# 36. Global Suppression Authority

DNC/unsubscribe is special.

Users can add suppression where legitimate.

But removing:

```text
UNSUBSCRIBE
DNC
GLOBAL SUPPRESSION
```

should be heavily restricted and governed by applicable rules.

AI cannot override.

---

# 37. AI Takeover Permission

Conversation:

```text
[Take Over]
```

requires:

```text
conversation.takeover
```

Researcher shouldn't necessarily be able to take over sales conversation.

---

# 38. Return to AI Permission

Likewise:

```text
[Return to AI]
```

could require appropriate sales authority.

Because it re-enables autonomous actions.

---

# 39. Pause AI Permissions

Different levels:

```text
Pause this conversation
Pause this company
Pause campaign
Pause mailbox
Pause all outbound
Global emergency stop
```

Not every user gets global kill controls.

---

# 40. Emergency Stop

Suggested:

```text
OWNER
✓

ADMIN
Configurable

SALES
✕
```

But Sales can perhaps pause own campaign.

---

# 41. Emergency Stop Cannot Be Blocked by AI

If authorized human presses:

```text
STOP ALL OUTBOUND
```

no AI rule can say:

```text
"Campaign is performing well,
so continue."
```

Human authority wins.

---

# 42. Global Kill Switch Audit

```text
OUTBOUND PAUSED

By:
Simon

At:
10:42 AM

Reason:
Manual emergency stop
```

Resume:

```text
Requires authorized human
```

---

# 43. Role Templates

Initial:

```text
Owner
Admin
Sales
Researcher
Viewer
```

User can later:

```text
Duplicate Role
```

Example:

```text
Sales
→ Senior Sales
```

Then customize.

---

# 44. Custom Role

```text
ROLE

Senior Sales

Based On
Sales

ADDITIONAL

✓ Approve proposals ≤ $15k
✓ Launch campaigns ≤ 250
✓ Review experiments

NOT ALLOWED

✕ Pricing policy changes
✕ AI global autonomy
✕ Integrations
```

---

# 45. Permission Inheritance

Role provides defaults.

User-specific overrides should be used sparingly:

```text
ROLE
Sales

USER OVERRIDE
Proposal approval ≤ $20K
```

UI must clearly show override.

---

# 46. Effective Permission Viewer

Very useful:

```text
WHAT CAN ALEX DO?
```

System displays actual effective permissions after:

```text
Role
+
Overrides
+
Scope
+
Authority limits
```

No guessing.

---

# 47. Permission Simulator

Admin:

```text
[View As Alex]
```

or:

```text
TEST PERMISSION

User:
Alex

Action:
Approve $18K proposal

RESULT:
DENIED

Reason:
Approval limit = $10K
```

Extremely useful.

---

# 48. Permission Explainability

When blocked:

Bad:

```text
403 Forbidden
```

Good:

```text
You don't have authority to approve
this proposal.

Your limit:
$10,000

Proposal:
$18,000

Required:
Owner approval

[Request Approval]
```

---

# 49. Request Access / Approval

If action denied because approval required:

```text
[Request Approval]
```

creates Screen #14 attention item.

No dead end.

---

# 50. Temporary Delegation

Suppose Simon is unavailable.

Could support:

```text
DELEGATE

Pricing approvals
To Mike

From
Oct 10

Until
Oct 14
```

Only within authority allowed by policy.

---

# 51. Delegation Restrictions

A person cannot delegate authority they don't possess.

```text
Alex has $10K authority
```

cannot delegate:

```text
$50K
```

to Mike.

---

# 52. Delegation Audit

```text
Pricing authority delegated

Simon → Mike

Effective
Oct 10–14

Created by
Simon
```

Automatically expires.

---

# 53. Out-of-Office Routing

User:

```text
Alex
Unavailable until Oct 12
```

System can reroute:

```text
New generic leads
→ Sarah

Existing Alex relationships
→ backup according to policy
```

Don't casually reassign active relationships.

---

# 54. Backup Owner

Per user:

```text
Alex

BACKUP
Simon
```

Used for:

```text
Urgent replies
Meetings
Approvals
Commitments
```

when unavailable.

---

# 55. Team Availability

Profile can include:

```text
WORKING HOURS
9 AM – 5 PM

TIMEZONE
...

MEETING HOURS
...
```

Calendar Screen #8 consumes this.

---

# 56. Notification Preferences

Per user:

```text
CRITICAL INCIDENTS
Immediate

PRICING APPROVAL
Immediate

MEETING PREP
Before meeting

ROUTINE AI ACTIVITY
No notification

DAILY SUMMARY
Enabled
```

Attention Center remains canonical queue.

---

# 57. Notification ≠ Permission

A user may have permission to view something but not receive alerts for it.

Separate concepts.

---

# 58. Data Visibility

For small internal team, default can be relatively open.

But support:

```text
ALL RECORDS

ASSIGNED RECORDS

TEAM RECORDS

SPECIFIC TERRITORIES
```

This prevents redesign if team grows.

---

# 59. Field-Level Restrictions

Certain fields may need stronger controls:

```text
Pricing Notes
Contract Notes
Internal Risk Notes
Integration Credentials
System Audit
```

Not every user necessarily sees all.

---

# 60. Internal Notes Visibility

Human note can be:

```text
TEAM
```

or:

```text
RESTRICTED
```

Example:

```text
Restricted:
Owner/Admin
```

AI also respects note access scope.

---

# 61. AI Must Respect User Permissions

Critical rule.

If Alex asks:

> “Show me all restricted contract notes.”

AI Sales Manager must check Alex's permissions before retrieving them.

Natural-language interface **cannot bypass RBAC**.

---

# 62. AI Actions Run Under Authority Context

If Alex asks AI:

> “Give this prospect 20% discount.”

System checks:

```text
REQUESTED BY
Alex

Alex authority
5%

AI authority
0 / approved policy

Requested
20%

→ DENIED / APPROVAL REQUIRED
```

AI isn't a privilege escalation mechanism.

---

# 63. AI Delegated Authority

When AI performs action:

```text
AI sent email
```

audit should know:

```text
AI Agent
Conversation Agent

Authority source
Autonomy Policy v4

Business owner
Workspace

Trigger
Inbound reply
```

AI isn't anonymous system magic.

---

# 64. AI Permission Boundary

AI permissions should be conceptually:

```text
SYSTEM CAPABILITY
∩
AUTONOMY POLICY
∩
BUSINESS RULE
∩
CURRENT CONTEXT
```

All must allow action.

Screen #17 will define this in depth.

---

# 65. Human Authority Beats AI Recommendation

AI:

```text
Recommended:
Wait
```

Authorized salesperson can choose:

```text
Call
```

unless a hard compliance/system rule forbids it.

AI recommendations aren't commands.

---

# 66. Hard Rules Beat Human Convenience

Conversely:

```text
Prospect unsubscribed
```

Sales user shouldn't casually click:

```text
Resume Campaign
```

Hard suppression policies apply.

---

# 67. Audit Log

Dedicated activity:

```text
TEAM ACTIVITY

Simon
Approved pricing

Alex
Took over conversation

Mike
Updated integration KB

Simon
Changed AI autonomy

Alex
Launched campaign
```

---

# 68. High-Risk Audit Events

Always capture:

```text
Role changes
Permission changes
Pricing authority changes
AI autonomy changes
Integration changes
Exports
Global pauses
Suppression changes
Knowledge policy changes
```

---

# 69. Audit Event Details

```text
PERMISSION CHANGE

User
Alex

Changed by
Simon

Before
Proposal approval: $10K

After
Proposal approval: $20K

Date
...

Reason
Optional / required for high-risk changes
```

---

# 70. Audit Immutability Principle

Normal user shouldn't be able to:

```text
Delete audit event
```

Otherwise audit trail becomes meaningless.

Retention later follows system policy.

---

# 71. Login Sessions

Team profile can show:

```text
ACTIVE SESSIONS

Chrome / Windows
Current

Other session
...
```

Allow:

```text
[Sign Out Other Sessions]
```

---

# 72. Account Security

Support:

```text
Password / auth provider
MFA capability
Session management
Login history
```

Exact authentication implementation technical architecture phase mein lock karenge.

---

# 73. MFA for High Authority

Owner/admin accounts should support stronger authentication requirements.

Especially because they can:

```text
Change AI autonomy
Connect mailboxes
Export data
Change pricing
Control users
```

---

# 74. Sensitive Action Re-Authentication

For very high-impact operations we can support re-authentication.

Example:

```text
Export all contacts

Change owner

Disable security control
```

System may request fresh authentication.

---

# 75. Owner Protection

Workspace must always have appropriate ownership continuity.

Don't allow accidental:

```text
Delete only Owner
```

without controlled transfer.

---

# 76. Ownership Transfer

Workflow:

```text
CURRENT OWNER
Simon

NEW OWNER
Mike

[Transfer Ownership]
```

Requires deliberate confirmation and audit.

Not a normal role dropdown.

---

# 77. Deactivating Team Member

When Alex leaves:

```text
[Deactivate]
```

System checks:

```text
12 Companies
7 Opportunities
4 Tasks
2 Meetings
1 Campaign
```

Then asks reassignment.

---

# 78. Offboarding Wizard

```text
DEACTIVATE ALEX

Reassign Companies
→ Simon

Reassign Opportunities
→ Simon

Open Tasks
→ Sarah

Campaign Ownership
→ Simon

Mailbox
Disable / Reassign

Calendar
Disconnect

Active Sessions
Revoke

[Confirm]
```

This prevents orphaned work.

---

# 79. Historical Ownership Preserved

After reassignment:

```text
Current Owner
Simon
```

Timeline still shows:

```text
Opportunity created by Alex
Meeting handled by Alex
Proposal drafted by Alex
```

History doesn't rewrite.

---

# 80. New User Onboarding

Invite accepted:

```text
WELCOME

Role:
Sales

Assigned markets:
Austin

Mailbox:
Connect

Calendar:
Connect

Working hours:
Configure

Notifications:
Configure

AI permissions:
Inherited from role
```

Fast onboarding.

---

# 81. Role-Based Home Experience

Owner Dashboard emphasizes:

```text
Revenue
Pipeline
AI health
Human bottlenecks
```

Researcher may see:

```text
Lead Hunter
Data review
Enrichment
Research queue
```

But we don't create entirely different applications.

Same product, permission-aware navigation.

---

# 82. Hidden vs Disabled Navigation

If user has zero access:

```text
Integrations
```

hide it.

If user can view but cannot edit:

```text
Pricing Policy
```

show read-only with clear permissions.

---

# 83. Assigned Market Rules

Example:

```text
Alex

Allowed:
Austin
Dallas
```

Lead Hunter can search other markets?

Configurable:

```text
VIEW
All

EXECUTE MARKET HUNT
Assigned only
```

Read and action permissions can differ.

---

# 84. AI Spend Authority

Important future control:

```text
Researcher

Can initiate deep research
up to configured per-job budget

Large batch
Requires approval
```

Otherwise one click could trigger expensive enrichment/LLM usage.

---

# 85. Bulk Research Authority

```text
Research 1 company
Allowed

Research 100 companies
Allowed

Deep research 10,000 companies
Approval required
```

Permission + cost policy.

---

# 86. Export Limits

Could define:

```text
Sales

Export:
Own assigned contacts
Max 500

Admin

Export:
All permitted records

Owner

Full export
```

Useful if team grows.

---

# 87. Data Access Audit

For sensitive operations:

```text
EXPORT

Alex exported:
412 contacts

Date:
...

Scope:
Austin prospects
```

Recorded.

---

# 88. Approval Routing

System should know:

```text
WHO CAN APPROVE THIS?
```

Example:

```text
$18K custom proposal
```

Possible approvers:

```text
Simon
Mike
```

Attention Center routes to eligible person.

---

# 89. Avoid Approval Deadlocks

If only approver unavailable:

```text
Simon
OOO
```

System detects:

```text
⚠ APPROVAL BOTTLENECK

No currently available eligible approver.
```

Use configured backup/delegation.

---

# 90. Separation of Duties

For particularly sensitive actions, future policy can require:

```text
Created by
Alex

Approved by
Simon
```

instead of same person.

Useful for:

```text
Large discounts
High-risk campaigns
Major AI policy changes
```

For 4–5 users this stays optional.

---

# 91. Permission Presets by Autonomy

Team permissions and AI autonomy are different.

Example:

```text
Alex may send emails manually
```

does NOT automatically mean:

```text
AI may send on Alex's behalf autonomously.
```

Screen #17 controls AI authority separately.

Critical distinction.

---

# 92. Mailbox Delegation

Mailbox:

```text
alex@company.com

Owner
Alex

AI Campaign Sending
Allowed

Other Humans
No

Admin Emergency Access
Policy controlled
```

Don't let every user casually send as every mailbox.

---

# 93. Calendar Delegation

Likewise:

```text
Simon Calendar

AI may:
Read availability
Book approved meeting types

Alex:
Cannot manually edit Simon's calendar
```

Integration permission and user permission both matter.

---

# 94. Team Analytics

Useful operational metrics:

```text
Open commitments
Opportunities owned
Meetings
Human attention items
Approval waiting time
```

But avoid turning it into employee surveillance.

Goal:

> Find operational bottlenecks, not micromanage people.

---

# 95. Natural-Language Team Queries

AI Sales Manager:

> “GreenScape ka owner kaun hai?”

> “Custom pricing approve kaun kar sakta hai?”

> “Mike unavailable ho to technical meeting kis ko route hogi?”

> “Alex ke paas kitni open opportunities hain?”

> “Kaun si approvals sirf mere paas blocked hain?”

Permissions apply to the answers.

---

# 96. Permission Change Preview

Before changing role:

```text
ALEX

Sales
→ Admin

NEW ACCESS

+ Integrations
+ Campaign management
+ Knowledge management
+ Team operational settings

HIGH-RISK CHANGES

+ Additional approval authority

[Confirm]
```

Prevents accidental privilege escalation.

---

# 97. Role Change Impact

If role reduced:

```text
Admin
→ Sales
```

System checks:

```text
Owned integrations?
Pending approvals?
Campaigns?
Knowledge review?
```

Then reassigns or flags dependencies.

---

# 98. Security Principle

Final authorization should always be enforced **server-side**.

UI hiding a button is not security.

Conceptually:

```text
USER ACTION
    ↓
AUTHENTICATE
    ↓
AUTHORIZE
    ↓
CHECK SCOPE
    ↓
CHECK BUSINESS POLICY
    ↓
EXECUTE
    ↓
AUDIT
```

---

# 99. Team Screen Final Layout

```text
┌────────────────────────────────────────────────────────┐
│ TEAM & ACCESS                           + Invite User   │
├────────────────────────────────────────────────────────┤
│ Team | Roles | Permissions | Assignments | Audit       │
├───────────────────┬────────────────────────────────────┤
│ TEAM              │ MEMBER                             │
│                   │                                    │
│ Simon   Owner     │ Alex                               │
│ Alex    Sales     │ Role: Sales                        │
│ Mike    Admin     │ Status: Active                     │
│ Sarah   Research  │                                    │
│                   │ Assigned Markets                   │
│                   │ Austin / Dallas                    │
│                   │                                    │
│                   │ Opportunity Authority              │
│                   │ Proposal: $10K                     │
│                   │ Discount: None                     │
│                   │                                    │
│                   │ Mailbox / Calendar                 │
│                   │ Working Hours                      │
│                   │ Permissions                        │
└───────────────────┴────────────────────────────────────┘
```

---

# 100. Ultimate Authority Model

Ye Screen #16 ka sabse important concept hai:

```text
IDENTITY
   ↓
ROLE
   ↓
PERMISSIONS
   ↓
DATA SCOPE
   ↓
AUTHORITY LIMIT
   ↓
BUSINESS POLICY
   ↓
ACTION
   ↓
AUDIT
```

AI ke case mein ek additional layer:

```text
HUMAN-DEFINED AUTHORITY
          ↓
AI AUTONOMY POLICY
          ↓
CONTEXT
          ↓
RISK
          ↓
CONFIDENCE
          ↓
ACTION / APPROVAL / BLOCK
```

## Screen #16 locked

Ab **16 / 18 primary screens complete** hain.

```text
01  Command Center                  ✓
02  AI Sales Manager                ✓
03  Lead Hunter                     ✓
04  Company + Prospect 360          ✓
05  Conversations                   ✓
06  Campaigns                       ✓
07  Opportunities                   ✓
08  Calendar + Meetings             ✓
09  Buying Signals                  ✓
10  Analytics + Revenue             ✓
11  Experiments + Learning          ✓
12  AI Memory                       ✓
13  Knowledge Base                  ✓
14  Human Attention                 ✓
15  Integrations                    ✓
16  Team + Roles + Permissions      ✓

17  AI Control Center               NEXT
18  Settings + System Admin
```

**Screen #17 sab se critical remaining screen hai**, kyun ke wahan hum actual autonomous AI ka control system lock karenge: **Level 0–4 autonomy, agent-by-agent permissions, send/spend limits, confidence thresholds, approval boundaries, pricing authority, research budgets, escalation rules, safety policies, global/market/campaign controls, emergency stop aur exactly kis condition mein AI ACT / ASK / WAIT / BLOCK karega.**