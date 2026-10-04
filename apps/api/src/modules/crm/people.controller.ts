import { Body, Controller, Delete, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { ContactPointService } from './contact-point.service.js';
import { ContactPointInput, EndEmploymentInput, UpdatePersonInput } from './crm.schemas.js';
import { PersonService } from './person.service.js';

const Id = new ParseUUIDPipe();

/** People, employment, contact points and fact corrections — the parts of Company 360 below the company itself. */
@Controller()
export class PeopleController {
  constructor(
    private readonly people: PersonService,
    private readonly contacts: ContactPointService,
    private readonly evidence: EvidenceService,
    private readonly access: AccessService,
  ) {}

  @Patch('people/:id')
  @RequirePermission('company.update')
  updatePerson(@Param('id', Id) id: string, @Body(new ZodValidationPipe(UpdatePersonInput)) input: z.output<typeof UpdatePersonInput>, @CurrentAccess() access: Access) {
    const { version, ...fields } = input;
    return this.people.update(this.access.serviceContext(access), id, version, fields);
  }

  @Post('people/:id/contact-points')
  @RequirePermission('company.update')
  addContactPoint(@Param('id', Id) id: string, @Body(new ZodValidationPipe(ContactPointInput)) input: z.output<typeof ContactPointInput>, @CurrentAccess() access: Access) {
    return this.contacts.add(this.access.serviceContext(access), { ...input, entityType: 'PERSON', entityId: id });
  }

  @Post('employments/:id/end')
  @RequirePermission('company.update')
  endEmployment(@Param('id', Id) id: string, @Body(new ZodValidationPipe(EndEmploymentInput)) input: z.output<typeof EndEmploymentInput>, @CurrentAccess() access: Access) {
    return this.people.endEmployment(this.access.serviceContext(access), id, input.endedAt);
  }

  @Post('contact-points/:id/primary')
  @RequirePermission('company.update')
  makePrimary(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return this.contacts.makePrimary(this.access.serviceContext(access), id);
  }

  /** Removes a contact point from use. It is archived, not deleted. */
  @Delete('contact-points/:id')
  @RequirePermission('company.update')
  archiveContactPoint(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return this.contacts.archive(this.access.serviceContext(access), id);
  }

  /** Picks the correct value among conflicting facts; the others are superseded (kept with their evidence). */
  @Post('facts/:id/resolve')
  @RequirePermission('evidence.manage')
  async resolveFact(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    const fact = await this.evidence.resolveConflict(this.access.serviceContext(access), id);
    return { id: fact.id, status: fact.status, field: fact.field };
  }
}
