import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { PrismaClient };
export { Prisma } from './generated/prisma/client.js';
export type {
  AgentDefinition,
  AgentTask,
  AiDecision,
  AiRun,
  ApprovalRequest,
  Campaign,
  CampaignEnrollment,
  CampaignMessage,
  CampaignStep,
  Company,
  CompanyAssessment,
  CompanyAlias,
  CoverageAssessment,
  DiscoveryMission,
  DiscoveryObservation,
  DiscoveryQuery,
  ContactPoint,
  Conversation,
  ConversationMessage,
  ConversationReply,
  ExtractionCandidate,
  MessageClassification,
  DeadLetterRecord,
  DomainEvent,
  Employment,
  EntityMatchCandidate,
  EntityMerge,
  Evidence,
  ExternalAction,
  Fact,
  Integration,
  IntegrationCredential,
  MailboxMessage,
  IntegrationCapabilityHealth,
  Market,
  Meeting,
  MeetingAttendee,
  MeetingBrief,
  MeetingChange,
  MeetingOutcome,
  MeetingType,
  SchedulingProfile,
  Opportunity,
  OpportunityLoss,
  OpportunityStageHistory,
  OpportunityStakeholder,
  PipelineStage,
  Qualification,
  QualificationAnswer,
  OpportunityHypothesis,
  OutboxEvent,
  Person,
  PolicyDecision,
  ProviderCallRecord,
  ResearchRun,
  SocialProfile,
  Suppression,
  Website,
  WebsiteAudit,
  WebsiteSnapshot,
} from './generated/prisma/client.js';
export * from './generated/prisma/enums.js';
export { DEFAULT_MEETING_TYPES, provisionMeetingTypes, provisionWorkspaceDefaults, syncPermissionCatalog } from './bootstrap.js';

/** Creates a Prisma client. Apps own its lifecycle (connect on start, `$disconnect()` on shutdown). */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
