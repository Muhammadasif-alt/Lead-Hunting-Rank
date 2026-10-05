import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { CompanyQueryService, presentCompany } from './company.query.js';
import { CompanyService } from './company.service.js';
import { ContactPointService } from './contact-point.service.js';
import {
  AddPersonInput,
  ArchiveInput,
  CompanyListQuery,
  ContactPointInput,
  CreateCompanyInput,
  ObservationInput,
  PageQuery,
  UpdateCompanyInput,
  VersionInput,
} from './crm.schemas.js';
import { EntityResolutionService } from './entity-resolution.service.js';
import { PersonService } from './person.service.js';
import { ResearchService } from './research.service.js';

const Id = new ParseUUIDPipe();

/**
 * Companies — Company 360 (screen #4, docs/14 §28). Reads need company.read; edits company.update; evidence
 * evidence.manage. Lifecycle changes are explicit commands (archive / restore), never a status PATCH.
 */
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompanyService,
    private readonly query: CompanyQueryService,
    private readonly resolution: EntityResolutionService,
    private readonly people: PersonService,
    private readonly contacts: ContactPointService,
    private readonly evidence: EvidenceService,
    private readonly research: ResearchService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('company.read')
  list(@Query(new ZodValidationPipe(CompanyListQuery)) q: z.output<typeof CompanyListQuery>, @CurrentAccess() access: Access) {
    return this.query.list(access.workspaceId, q);
  }

  /** Create-form preflight: likely duplicates of what the user is typing. Writes nothing. */
  @Post('check-duplicates')
  @RequirePermission('company.read')
  async checkDuplicates(@Body(new ZodValidationPipe(CreateCompanyInput)) input: CreateCompanyInput, @CurrentAccess() access: Access) {
    const matches = await this.resolution.preview(access.workspaceId, this.companies.matchRecord(input));
    return matches.map((m) => ({ company: presentCompany(m.company), score: m.match.score, confidence: m.match.confidence, matching: m.match.matching, conflicting: m.match.conflicting }));
  }

  @Post()
  @RequirePermission('company.update')
  async create(@Body(new ZodValidationPipe(CreateCompanyInput)) input: CreateCompanyInput, @CurrentAccess() access: Access) {
    const company = await this.companies.create(this.access.serviceContext(access), input);
    return { company: presentCompany(company), openDuplicates: await this.query.openDuplicateCount(access.workspaceId, company.id) };
  }

  @Get(':id')
  @RequirePermission('company.read')
  overview(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return this.query.overview(access.workspaceId, id, access.permissions);
  }

  @Get(':id/activity')
  @RequirePermission('company.read')
  activity(@Param('id', Id) id: string, @Query(new ZodValidationPipe(PageQuery)) q: z.output<typeof PageQuery>, @CurrentAccess() access: Access) {
    return this.query.activity(access.workspaceId, id, q);
  }

  @Patch(':id')
  @RequirePermission('company.update')
  async update(@Param('id', Id) id: string, @Body(new ZodValidationPipe(UpdateCompanyInput)) input: z.output<typeof UpdateCompanyInput>, @CurrentAccess() access: Access) {
    const { version, ...fields } = input;
    return presentCompany(await this.companies.update(this.access.serviceContext(access), id, version, fields));
  }

  @Post(':id/archive')
  @RequirePermission('company.update')
  async archive(@Param('id', Id) id: string, @Body(new ZodValidationPipe(ArchiveInput)) input: z.output<typeof ArchiveInput>, @CurrentAccess() access: Access) {
    return presentCompany(await this.companies.archive(this.access.serviceContext(access), id, input.version, input.reason));
  }

  @Post(':id/restore')
  @RequirePermission('company.update')
  async restore(@Param('id', Id) id: string, @Body(new ZodValidationPipe(VersionInput)) input: z.output<typeof VersionInput>, @CurrentAccess() access: Access) {
    return presentCompany(await this.companies.restore(this.access.serviceContext(access), id, input.version));
  }

  @Post(':id/detect-duplicates')
  @RequirePermission('company.update')
  async detectDuplicates(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return { openDuplicates: await this.companies.detectDuplicates(this.access.serviceContext(access), id) };
  }

  /** Research now (website, checks, contacts, verification, hypotheses). 202: the worker does it; poll the overview. */
  @Post(':id/research')
  @HttpCode(202)
  @RequirePermission('company.research')
  requestResearch(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return this.research.request(this.access.serviceContext(access), id);
  }

  @Post(':id/people')
  @RequirePermission('company.update')
  addPerson(@Param('id', Id) id: string, @Body(new ZodValidationPipe(AddPersonInput)) input: z.output<typeof AddPersonInput>, @CurrentAccess() access: Access) {
    return this.people.addToCompany(this.access.serviceContext(access), id, input);
  }

  @Post(':id/contact-points')
  @RequirePermission('company.update')
  addContactPoint(@Param('id', Id) id: string, @Body(new ZodValidationPipe(ContactPointInput)) input: z.output<typeof ContactPointInput>, @CurrentAccess() access: Access) {
    return this.contacts.add(this.access.serviceContext(access), { ...input, entityType: 'COMPANY', entityId: id });
  }

  /** "I saw this value at this source on this date" → Evidence + Fact (conflicts flagged, never overwritten). */
  @Post(':id/observations')
  @RequirePermission('evidence.manage')
  async observe(@Param('id', Id) id: string, @Body(new ZodValidationPipe(ObservationInput)) input: z.output<typeof ObservationInput>, @CurrentAccess() access: Access) {
    await this.companies.assertActive(access.workspaceId, id);
    const { fact, outcome, evidence } = await this.evidence.recordObservation(this.access.serviceContext(access), { ...input, entityType: 'COMPANY', entityId: id });
    return { factId: fact.id, evidenceId: evidence.id, outcome, status: fact.status };
  }
}
