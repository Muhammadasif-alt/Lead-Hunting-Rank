import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { InfraModule } from './infra/infra.module.js';
import { HealthModule } from './health/health.module.js';
import { DomainModule } from './modules/domain.module.js';

// Business modules (CompanyModule, MarketModule, …) are added here phase by phase — see docs/04-tech-spec-1-architecture.md §11.
@Module({
  imports: [InfraModule, CommonModule, HealthModule, DomainModule],
})
export class AppModule {}
