// Server-side domain logic shared by the API and the worker (both need it inside their transactions).
// Nest-free on purpose: plain functions over a Prisma transaction client and a ServiceContext.
export * from './context.js';
export * from './crm/company-merge.js';
export * from './crm/company-records.js';
export * from './crm/entity-resolution.js';
export * from './discovery/index.js';
export * from './evidence/evidence.js';
export * from './research/index.js';
