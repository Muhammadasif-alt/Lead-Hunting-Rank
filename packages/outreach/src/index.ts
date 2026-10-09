// Campaigns + outreach (Phase 11, docs/17 §67-76, screen #6): audience → checks → launch → per-step drafting by the
// Campaign Agent → Policy Engine → ExternalAction → follow-ups that re-check first → replies, unsubscribes and bounces
// stop the sequence. No provider is called from here except through the gateway.
export * from './audience.js';
export * from './campaigns.js';
export * from './engine.js';
export * from './inbound.js';
export * from './preview.js';
// Conversations + AI Inbox (Phase 12, docs/17 §77-86, screen #5): a reply joins its conversation in the same
// transaction that stops the cold sequence → Inbox Agent reads it → rules decide category/stage → Conversation Agent
// drafts → Policy Engine (email.reply) → sent, or a person takes it.
export * from './conversation-commands.js';
export * from './conversation-engine.js';
export * from './conversation-inbound.js';
export * from './conversation-rules.js';
// Qualification + opportunities (Phase 13, docs/17 §87-92, screen #7): deals from commercial evidence, stage commands
// with requirements and history, evidence-based health and next action, explicit won / lost.
export * from './opportunities.js';
export * from './opportunity-rules.js';
