import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { InfraModule } from './infra/infra.module.js';
import { HealthModule } from './health/health.module.js';
import { DomainModule } from './modules/domain.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { DiscoveryModule } from './modules/discovery/discovery.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { PolicyModule } from './modules/policy/policy.module.js';
import { CampaignsModule } from './modules/campaigns/campaigns.module.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { KnowledgeModule } from './modules/knowledge/knowledge.module.js';
import { SignalsModule } from './modules/signals/signals.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';

// Business modules (CompanyModule, MarketModule, â€¦) are added here phase by phase â€” see docs/04-tech-spec-1-architecture.md Â§11.
@Module({
  imports: [InfraModule, CommonModule, HealthModule, DomainModule, AuthModule, SystemModule, IntegrationsModule, CrmModule, DiscoveryModule, GeoModule, AiModule, PolicyModule, CampaignsModule, ConversationsModule, OpportunitiesModule, MeetingsModule, KnowledgeModule, SignalsModule, AnalyticsModule],
})
export class AppModule {}
