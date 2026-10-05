import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DomainModule } from '../domain.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompanyQueryService } from './company.query.js';
import { DuplicatesController } from './duplicates.controller.js';
import { PeopleController } from './people.controller.js';
import { ResearchService } from './research.service.js';

/** CRM Core — Company 360 (Phase 6) + research (Phase 8): companies, people, contacts, evidence/facts, duplicates, merges. */
@Module({
  imports: [AuthModule, DomainModule],
  controllers: [CompaniesController, PeopleController, DuplicatesController],
  providers: [CompanyQueryService, ResearchService],
})
export class CrmModule {}
