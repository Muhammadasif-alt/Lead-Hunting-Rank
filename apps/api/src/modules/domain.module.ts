import { Module } from '@nestjs/common';
import { ContactPointService } from './crm/contact-point.service.js';
import { CompanyService } from './crm/company.service.js';
import { PersonService } from './crm/person.service.js';
import { EvidenceService } from './evidence/evidence.service.js';
import { WorkspaceService } from './identity/workspace.service.js';

const SERVICES = [WorkspaceService, CompanyService, PersonService, ContactPointService, EvidenceService];

/** Application services (Phase 2). HTTP controllers arrive with their phases — Company 360 in Phase 6. */
@Module({ providers: SERVICES, exports: SERVICES })
export class DomainModule {}
