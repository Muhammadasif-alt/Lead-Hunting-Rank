import { Module } from '@nestjs/common';
import { ContactPointService } from './crm/contact-point.service.js';
import { CompanyService } from './crm/company.service.js';
import { PersonService } from './crm/person.service.js';
import { EntityResolutionService } from './crm/entity-resolution.service.js';
import { EvidenceService } from './evidence/evidence.service.js';
import { WorkspaceService } from './identity/workspace.service.js';

const SERVICES = [WorkspaceService, EntityResolutionService, CompanyService, PersonService, ContactPointService, EvidenceService];

/** Application services shared by HTTP modules (CrmModule, …) and tests. */
@Module({ providers: SERVICES, exports: SERVICES })
export class DomainModule {}
