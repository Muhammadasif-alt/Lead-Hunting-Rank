import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildBrief, meetingNextAction, meetingTypeBlocked, noShowRisk, recommendMeetingType, recommendStage, routeMeeting, type BriefInput } from './meeting-rules.js';

const NOW = new Date('2026-10-07T15:00:00.000Z');
const types = [
  { id: 'd', key: 'DISCOVERY', requiredQualification: 'NONE' as const, active: true, position: 0 },
  { id: 'c', key: 'CONSULTATION', requiredQualification: 'NEED' as const, active: true, position: 1 },
  { id: 't', key: 'TECHNICAL_DEMO', requiredQualification: 'QUALIFIED' as const, active: true, position: 2 },
  { id: 'p', key: 'PROPOSAL_REVIEW', requiredQualification: 'QUALIFIED' as const, active: true, position: 3 },
];

describe('meeting types — qualification protects the calendar', () => {
  test('a demo needs a qualified deal; a discovery call is open to anyone who asks', () => {
    assert.match(meetingTypeBlocked('QUALIFIED', { known: new Set(['NEED']), qualified: false }) ?? '', /qualified deal/);
    assert.equal(meetingTypeBlocked('NONE', { known: new Set(), qualified: false }), null);
    assert.match(meetingTypeBlocked('NEED', { known: new Set(), qualified: false }) ?? '', /stated need/);
  });
  test('recommendation follows the deal: discovery first, demo after a meeting, proposal review at proposal', () => {
    assert.equal(recommendMeetingType(types, { stage: null, known: new Set(), qualified: false, hadMeeting: false })?.key, 'DISCOVERY');
    assert.equal(recommendMeetingType(types, { stage: 'MEETING', known: new Set(['NEED', 'TIMELINE']), qualified: true, hadMeeting: true })?.key, 'TECHNICAL_DEMO');
    assert.equal(recommendMeetingType(types, { stage: 'PROPOSAL', known: new Set(['NEED', 'TIMELINE']), qualified: true, hadMeeting: true })?.key, 'PROPOSAL_REVIEW');
    // Not qualified: the demo is not offered even after a meeting.
    assert.equal(recommendMeetingType(types, { stage: 'MEETING', known: new Set(['NEED']), qualified: false, hadMeeting: true })?.key, 'DISCOVERY');
  });
});

describe('routing — relationship first, then a backup, then round robin', () => {
  const simon = { userId: 's', name: 'Simon', acceptsMeetings: true, unavailableUntil: null, upcoming: 3 };
  const alex = { userId: 'a', name: 'Alex', acceptsMeetings: true, unavailableUntil: null, upcoming: 1 };
  const mike = { userId: 'm', name: 'Mike', acceptsMeetings: true, unavailableUntil: null, upcoming: 2 };
  test('the relationship owner keeps the meeting even with a busier week', () => {
    const r = routeMeeting({ candidates: [simon, alex, mike], relationship: [{ userId: 's', why: 'owns the deal' }], now: NOW });
    assert.equal(r?.userId, 's');
    assert.match(r?.reason ?? '', /Existing relationship: Simon/);
  });
  test('owner away → backup with the lightest week, saying why; no relationship → round robin', () => {
    const away = { ...simon, unavailableUntil: new Date('2026-10-17T00:00:00Z') };
    const r = routeMeeting({ candidates: [away, alex, mike], relationship: [{ userId: 's', why: 'owns the deal' }], now: NOW });
    assert.equal(r?.userId, 'a');
    assert.match(r?.reason ?? '', /Simon is away until 2026-10-17/);
    assert.equal(routeMeeting({ candidates: [simon, alex, mike], relationship: [], now: NOW })?.userId, 'a');
    assert.equal(routeMeeting({ candidates: [], relationship: [], now: NOW }), null);
  });
});

describe('the brief — known, unknown, don’t ask again, gaps', () => {
  const input: BriefInput = {
    meeting: { typeKey: 'DISCOVERY', typeName: 'Discovery call', startAt: NOW, timezone: 'America/Chicago', timezoneConfidence: 'LOW', locationType: 'VIDEO', meetingUrl: null },
    company: { name: 'Evergreen Lawn', industry: 'Landscaping', city: 'Austin', region: 'TX', website: 'evergreen.example' },
    people: [
      { name: 'Grace Lee', title: 'Owner', side: 'EXTERNAL', role: 'Prospect' },
      { name: 'Sam', title: null, side: 'INTERNAL', role: 'Owner' },
    ],
    deal: { name: 'Evergreen — Online booking', stage: 'QUALIFIED', service: 'Online booking', originReason: 'Stated a need and a timeline', originQuote: 'We need online booking before spring.' },
    known: [
      { key: 'NEED', value: 'online booking before spring', quote: 'We need online booking before spring.', verified: false },
      { key: 'TIMELINE', value: 'next month', quote: 'ideally next month', verified: true },
    ],
    questionsAsked: ['How long does setup take?'],
    objections: [{ type: 'ALREADY_HAS_SOLUTION', text: 'We already use a booking widget on Facebook.' }],
    stakeholders: [{ name: 'Partner (name unknown)', role: 'DECISION_MAKER', status: 'SUGGESTED' }],
    hypotheses: [{ label: 'May lose bookings without an online form', confidence: 'MEDIUM' }],
    previousMeetings: [],
    conversationSummary: null,
    lastResearchAt: new Date(NOW.getTime() - 120 * 86_400_000),
    now: NOW,
  };
  test('asks only what is unknown, with reasons from what they said; never re-asks what is known', () => {
    const { content, gaps } = buildBrief(input);
    assert.equal(content.need, 'online booking before spring');
    assert.ok(content.dontAskAgain.includes('Need: online booking before spring'));
    assert.ok(content.dontAskAgain.includes('Grace Lee is Owner'));
    assert.ok(!content.suggestedQuestions.some((q) => /when would you like/i.test(q.question)), 'the timeline is known');
    assert.ok(content.suggestedQuestions.some((q) => /partner/i.test(q.reason)), 'the mentioned partner shapes the decision question');
    assert.ok(content.suggestedQuestions.some((q) => /existing provider/i.test(q.reason)));
    assert.ok(content.suggestedQuestions.length <= 5);
    assert.ok(gaps.some((g) => /120 days old/.test(g)));
    assert.ok(gaps.some((g) => /time zone is a guess/.test(g)));
    assert.equal(content.who[0]?.name, 'Grace Lee');
    assert.equal(content.team[0]?.name, 'Sam');
  });
});

describe('after the meeting', () => {
  const deal = { semantic: 'MEETING' as const, status: 'OPEN' as const, known: new Set(['NEED', 'TIMELINE']), hasPrimaryContact: true, service: 'Online booking', amountMinor: null, reached: new Set(['NEW', 'QUALIFIED', 'MEETING']) };
  test('advanced → the next real step; lost goes through Mark lost; a no-show is never lost', () => {
    assert.equal(recommendStage('ADVANCED', deal).stage, 'PROPOSAL');
    assert.equal(recommendStage('ADVANCED', { ...deal, semantic: 'DISCOVERY', known: new Set(['NEED', 'AUTHORITY']) }).stage, 'QUALIFIED');
    assert.equal(recommendStage('ADVANCED', { ...deal, semantic: 'DISCOVERY', known: new Set() }).stage, null);
    assert.equal(recommendStage('LOST', deal).stage, null);
    assert.equal(recommendStage('NO_SHOW', deal).stage, null);
    assert.equal(recommendStage('NURTURE', deal).stage, 'NURTURE');
    assert.equal(noShowRisk(1), null);
    assert.match(noShowRisk(2) ?? '', /confirm before reserving/);
  });
  test('next action reads the state', () => {
    const base = { startAt: null, endAt: null, pendingStartAt: null, offeredAt: null, slots: 0, statusReason: null, hasOwner: true };
    assert.match(meetingNextAction({ ...base, status: 'PROPOSED', slots: 3 }, NOW), /Offer these times/);
    assert.match(meetingNextAction({ ...base, status: 'PROPOSED', hasOwner: false }, NOW), /Set up availability/);
    assert.match(meetingNextAction({ ...base, status: 'BOOKED', startAt: new Date(NOW.getTime() - 3_600_000), endAt: new Date(NOW.getTime() - 1_800_000) }, NOW), /Record the outcome/);
    assert.match(meetingNextAction({ ...base, status: 'NO_SHOW' }, NOW), /not a lost deal/);
  });
});
