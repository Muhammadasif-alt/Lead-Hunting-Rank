// Campaigns + outreach (Phase 11, docs/17 §67-76, screen #6): audience → checks → launch → per-step drafting by the
// Campaign Agent → Policy Engine → ExternalAction → follow-ups that re-check first → replies, unsubscribes and bounces
// stop the sequence. No provider is called from here except through the gateway.
export * from './audience.js';
export * from './campaigns.js';
export * from './engine.js';
export * from './inbound.js';
export * from './preview.js';
