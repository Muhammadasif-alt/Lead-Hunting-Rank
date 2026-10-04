import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DomainModule } from '../domain.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompanyQueryService } from './company.query.js';
import { DuplicatesController } from './duplicates.controller.js';
import { PeopleController } from './people.controller.js';

/** CRM Core — Company 360 (Phase 6): companies, people, contact points, evidence/facts, duplicates and merges. */
@Module({
  imports: [AuthModule, DomainModule],
  controllers: [CompaniesController, PeopleController, DuplicatesController],
  providers: [CompanyQueryService],
})
export class CrmModule {}
