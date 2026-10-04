import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { InfraModule } from './infra/infra.module.js';
import { HealthModule } from './health/health.module.js';
import { DomainModule } from './modules/domain.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';

// Business modules (CompanyModule, MarketModule, …) are added here phase by phase — see docs/04-tech-spec-1-architecture.md §11.
@Module({
  imports: [InfraModule, CommonModule, HealthModule, DomainModule, AuthModule, SystemModule, IntegrationsModule],
})
export class AppModule {}
