import type { Capability, CostModel, ProviderCategory } from './core/capabilities.js';

/**
 * Provider registry (docs/12 §10). A provider is a technical implementation; an Integration is one workspace's
 * connection to it (docs/12 §3). Browser-safe — the Integrations screen renders this catalog.
 *
 * `status`:
 * - AVAILABLE — implemented and connectable now;
 * - PLANNED — real vendor adapter, arrives in `plannedPhase` (shown honestly, not as a working button).
 * Fake providers simulate a vendor with deterministic data so domain workflows can be built and tested safely;
 * they are never offered in production.
 */
export interface ProviderDefinition {
  key: string;
  name: string;
  category: ProviderCategory;
  capabilities: Capability[];
  costModel: CostModel;
  /** How a workspace connects it. Credentials (API key / OAuth) arrive with the first real adapter. */
  connection: 'NONE' | 'API_KEY' | 'OAUTH';
  fake: boolean;
  status: 'AVAILABLE' | 'PLANNED';
  plannedPhase?: number;
  description: string;
}

export const PROVIDER_CATALOG: ProviderDefinition[] = [
  // ── fake providers (development / test) ──
  {
    key: 'fake_email',
    name: 'Test mailbox',
    category: 'EMAIL',
    capabilities: ['EMAIL_SEND', 'EMAIL_READ'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Simulated mailbox. Messages are stored, never delivered — safe for building and testing outreach.',
  },
  {
    key: 'fake_calendar',
    name: 'Test calendar',
    category: 'CALENDAR',
    capabilities: ['CALENDAR_READ', 'CALENDAR_WRITE'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Simulated calendar with working-hours busy blocks. Events are stored, nobody is invited.',
  },
  {
    key: 'fake_leads',
    name: 'Test lead source',
    category: 'LEAD_DATA',
    capabilities: ['COMPANY_SEARCH'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Maps-style test source: fictional, repeatable businesses for any city and industry — including duplicate listings and businesses without a website.',
  },
  {
    key: 'fake_directory',
    name: 'Test business directory',
    category: 'LEAD_DATA',
    capabilities: ['COMPANY_SEARCH'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Directory-style test source over the same fictional market: knows fewer businesses, formats them differently and sometimes lists an old phone number.',
  },
  {
    key: 'fake_verification',
    name: 'Test email verifier',
    category: 'VERIFICATION',
    capabilities: ['EMAIL_VERIFY'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Rule-based verifier with predictable answers (VALID, INVALID, RISKY, CATCH_ALL, UNKNOWN).',
  },
  {
    key: 'fake_llm',
    name: 'Test AI model',
    category: 'AI',
    capabilities: ['LLM_REASONING', 'LLM_EXTRACTION'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Deterministic stand-in for a language model. Returns scripted or echo answers; output is still schema-validated.',
  },
  {
    key: 'fake_notifications',
    name: 'In-app notifications (test)',
    category: 'NOTIFICATIONS',
    capabilities: ['NOTIFY'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: true,
    status: 'AVAILABLE',
    description: 'Records notifications instead of delivering them.',
  },
  // ── real, available now ──
  {
    key: 'local_storage',
    name: 'Local file storage',
    category: 'STORAGE',
    capabilities: ['STORAGE'],
    costModel: 'FREE',
    connection: 'NONE',
    fake: false,
    status: 'AVAILABLE',
    description: 'Private files on the server disk (STORAGE_LOCAL_PATH). For development; production uses S3-compatible storage.',
  },
  // ── real vendors, planned (docs/12 §1 recommended order) ──
  {
    key: 'anthropic',
    name: 'Anthropic Claude',
    category: 'AI',
    capabilities: ['LLM_REASONING', 'LLM_EXTRACTION'],
    costModel: 'PER_TOKEN',
    connection: 'API_KEY',
    fake: false,
    status: 'PLANNED',
    plannedPhase: 9,
    description: 'Language model for research, classification and drafting, behind the AI gateway.',
  },
  {
    key: 'gmail',
    name: 'Gmail',
    category: 'EMAIL',
    capabilities: ['EMAIL_SEND', 'EMAIL_READ'],
    costModel: 'FREE',
    connection: 'OAUTH',
    fake: false,
    status: 'PLANNED',
    plannedPhase: 10,
    description: 'Send and sync email from your own mailbox, with minimum OAuth scopes.',
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    category: 'CALENDAR',
    capabilities: ['CALENDAR_READ', 'CALENDAR_WRITE'],
    costModel: 'FREE',
    connection: 'OAUTH',
    fake: false,
    status: 'PLANNED',
    plannedPhase: 13,
    description: 'Real availability and provider-confirmed bookings.',
  },
  {
    key: 's3',
    name: 'S3-compatible storage',
    category: 'STORAGE',
    capabilities: ['STORAGE'],
    costModel: 'UNKNOWN',
    connection: 'API_KEY',
    fake: false,
    status: 'PLANNED',
    plannedPhase: 14,
    description: 'Private bucket for knowledge documents, snapshots and exports.',
  },
];

export function providerDefinition(key: string): ProviderDefinition | undefined {
  return PROVIDER_CATALOG.find((p) => p.key === key);
}

/** Providers a workspace may connect in this environment. Fakes never in production. */
export function isConnectable(def: ProviderDefinition, appEnv: string): boolean {
  return def.status === 'AVAILABLE' && def.connection === 'NONE' && !(def.fake && appEnv === 'production');
}
