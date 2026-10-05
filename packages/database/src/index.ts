import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { PrismaClient };
export { Prisma } from './generated/prisma/client.js';
export type {
  Company,
  CompanyAlias,
  CoverageAssessment,
  DiscoveryMission,
  DiscoveryObservation,
  DiscoveryQuery,
  ContactPoint,
  DeadLetterRecord,
  DomainEvent,
  Employment,
  EntityMatchCandidate,
  EntityMerge,
  Evidence,
  ExternalAction,
  Fact,
  Integration,
  IntegrationCapabilityHealth,
  Market,
  OutboxEvent,
  Person,
  ProviderCallRecord,
} from './generated/prisma/client.js';
export * from './generated/prisma/enums.js';
export { provisionWorkspaceDefaults, syncPermissionCatalog } from './bootstrap.js';

/** Creates a Prisma client. Apps own its lifecycle (connect on start, `$disconnect()` on shutdown). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
