# Screen #6: Campaigns & Autonomous Outreach Engine

## Main Campaign screen
List: name, status (Running/Experiment/Research), prospects, contacted, replies, positive, qualified, meetings, AI Health, human needed 2. Top-level metrics: qualified opportunities, meetings, pipeline, revenue — not open rate.

## 1. Create Campaign
[+ New Campaign] → Build With AI / Advanced Manual Setup. NL prompt → AI queries Lead Hunter data → Campaign Plan (market, industry, segment, requirements, matches count, primary/secondary opportunity, recommended initial cohort 20, [Continue]).

## 2. Campaign Objective
Start conversations / Book qualified meetings / Generate quote requests / Re-engage old / Validate market / Custom. PRIMARY GOAL, SECONDARY, NOT A GOAL — no "maximize opens".

## 3. Audience Definition
Live segment: market, industry, conditions (website NONE, owner FOUND, email VERIFIED, reviews ≥50, status ACTIVE), current matches. Auto-enroll new matches: Never / After AI validation / Automatically.

## 4. Dynamic Audience
Condition no longer true → remove from campaign. E.g., website launched → "No Website" outreach stops.

## 5. Campaign Strategy
AI generates strategy doc: audience, observed characteristics, primary hypothesis, messaging principle, avoid (fake compliments, fear claims, unsupported promises, private info), CTA, tone. User editable.

## 6. Offer Mapping
Primary offer + optional relevant services. AI picks relevant per research, doesn't dump all services.

## 7. Personalization Architecture
Campaign strategy + persona + company facts + digital audit + buying signals + previous relationship + approved offer → personalized message. Same family, different message per evidence.

## 8. Evidence-backed Personalization
Every personalization claim: evidence, confidence, allowed YES/NO. Low confidence → no "you don't have a website" claim.

## 9. Message Studio
Opening specific+factual, body opportunity, offer relevant, CTA simple. Rules: max words 90, 1 question, 0 links first email, 0 attachments, 0 emojis, no fake urgency, no unsupported claims.

## 10. AI Writing Guardrails
Concise, conversational, professional, specific, plain English. NEVER: "hope this finds you well", fake compliments, invented facts, guaranteed results, deceptive RE/FWD, fake prior relationship.

## 11. Message Preview Per Prospect
Preview + WHY + grounding PASS + policy PASS + personalization HIGH CONFIDENCE. User cycles 10 random before approval.

## 12. Sequence Builder
Day 0 email → adaptive wait 2–4 days → if no reply FU#1 → wait → if still relevant FU#2 → end/nurture. Not dumb fixed timers.

## 13. Adaptive Follow-up Engine
Before each FU check: reply?, employee reply?, unsubscribed?, email valid?, active?, website changed?, opportunity changed?, active conversation?, limits reached?, new useful context?.

## 14. Follow-up Strategy
Not "just following up". AI options: clarify value / new observation / answer likely question / case study / close-the-loop / stop.

## 15. Intelligent Stop Conditions
Reply, unsubscribe, invalid, meeting booked, opportunity created, human takeover, account conversation active, business closed, invalid, max reached.

## 16. Account-Level Protection
Another employee engaged → Sarah's outreach PAUSED.

## 17. Mailbox Engine
Multiple mailboxes with health + today/limit. Distribution engine.

## 18. Mailbox Selection
Campaign owner, previous sender relationship, health, capacity, timezone, existing thread, domain rules.

## 19. Sending Schedule
Prospect local time, weekday 8:30–4:30, weekend off. No 3AM.

## 20. Rate Control
Daily max 35, hourly 8, variable gap, emergency throttle ON.

## 21. Deliverability Health
Mailbox health, bounce rate, provider failures, unsubscribe. Risk → pause risky, reduce volume, recheck verification, notify admin.

## 22. Pre-Send Gate
Suppression → account conflict → validity → campaign eligibility → freshness → personalization grounding → policy → mailbox health → rate limit → SEND.

## 23. Campaign Experiments
A/B variants, allocation 50/50.

## 24. Experiment Metrics
Positive reply, qualified conversation, meeting, opportunity, revenue, unsubscribe, negative. Not open rate.

## 25. AI Experiment Scientist
Observation + CAUTION + RECOMMENDATION. Minimum sample before conclude.

## 26. Automatic Experiment Generation
AI proposes new experiment, human approves. No secret strategy change.

## 27. Campaign Learning
Strongest segment/persona/question/objection/CTA/weak segment with sample sizes.

## 28. Campaign Health Score
Audience/Data/Deliverability/Reply/Qualification/Meeting Conversion/Compliance. Watch → explain + analyze.

## 29. AI Campaign Manager
NL queries inside campaign.

## 30. Autonomous Optimization Levels
Manual / Controlled / Autonomous (within strict boundaries).

## 31. Variables AI May Optimize
Send timing, prospect priority, FU timing, approved message variation, CTA variation, segment allocation, research depth. NOT: price, discount, legal terms, global limits, compliance, suppression.

## 32. Campaign Budget
Max prospects 500, max new/day 50, max FU/person 3, research API $, enrichment $, AI usage $. Alert at 73%.

## 33. Cost Per Outcome
Data/AI/email infra cost → per researched lead, per qualified conversation, per meeting, per won customer.

## 34. Campaign Cohorts
Cohort 1 (25) → validation → Cohort 2 (75) → expansion → Cohort 3 (200) → scale.

## 35. Pre-Launch Simulation
Checklist: audience/suppression/verification/strategy/KB/mailboxes/limits/reply handling/calendar/human escalation. Potential issue: 4 uncertain website status → exclude. Readiness 96% → [Launch Cohort 1].

## 36. Dry Run
[Run Without Sending] — 20 prospects processed (research, personalization, generation, policy, mailbox), no actual send. User reviews 18 PASS/2 REVIEW/0 FAIL.

## 37. Live Campaign Feed
Sent/skipped (website changed)/reply→FU stopped/enrolled/verification failed.

## 38. Campaign Funnel
Eligible → contactable → contacted → replied → positive → qualified → meeting requested → booked → opportunity → won.

## 39. Reason Funnel
Not contacted breakdown: no verified email, opportunity changed, account conflict, low confidence, suppressed, inactive, other.

## 40. Reply Breakdown
Interested/question/not now/wrong person/negative/unsubscribe/other + outcomes.

## 41. Campaign → AI Inbox boundary
Reply arrives → campaign automation STOP → Conversation Engine → AI Inbox. Campaign doesn't control active conversation.

## 42. Re-engagement Campaigns
Types: New Prospecting/Re-engagement/Nurture/Event/Signal Triggered/Customer Expansion/Referral.

## 43. Signal-Triggered Campaigns
Event-driven campaigns. New service launch → research → relevance → eligibility → outreach. No-website → website appears → cancel.

## 44. Continuous Market Campaign
Saved market → new business matches criteria → AI validation → controlled enrollment. Continuous lead gen + outreach.

## 45. Campaign Conflict Resolver
Prospect matches 3 campaigns → select highest relevance, others suppressed while active.

## 46. Global Frequency Cap
Max 4 cold attempts/person/30 days, account-level cap, cooldown.

## 47. Revenue Feedback Loop
Won deal → market → signal → campaign → message strategy → persona → conversation → meeting → revenue → Lead Hunter learning.

## 48. Clone Successful Campaign
[Find Another Market Like This] — extract winning ICP/structure, reuse research rules, run new validation cohort. Don't blindly reuse message/performance.

## 49. Emergency Controls
Pause New Sends / Pause Follow-ups / Pause Campaign / Stop Campaign / STOP ALL OUTBOUND (incoming still processed).

## 50. Ultimate workflow
MARKET → SEGMENT → RESEARCH → VALIDATE OPPORTUNITY → STRATEGY → PERSONALIZATION → PRE-SEND GATE → CONTROLLED COHORT → OUTREACH → ADAPTIVE FOLLOW-UP → REPLY → STOP CAMPAIGN AUTOMATION → AI CONVERSATION → QUALIFICATION → MEETING → OPPORTUNITY → REVENUE → LEARNING → BETTER NEXT CAMPAIGN.

## Boundary lock
Lead Hunter = who exists/who relevant. Campaign Engine = who to contact/how. Conversation Engine = after engagement. AI Sales Manager = supervises. Human = authority over high-risk.
