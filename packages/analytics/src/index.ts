// Analytics + Attribution (Phase 17, docs/17 §111-113): lifecycle attribution Source → Company → Signal → Campaign →
// Message → Conversation → Meeting → Opportunity → Revenue; revenue events; a derived daily projection; read models in
// the shared API shapes; and a deterministic "ask your revenue data" router. Analytics never sends anything.
export * from './deps.js';
export * from './scope.js';
export * from './attribution.js';
export * from './revenue.js';
export * from './rollup.js';
export * from './metrics.js';
export * from './overview.js';
export * from './economics.js';
export * from './ask.js';
export * from './views.js';
