import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { CompanyQueryService, presentCompany } from './company.query.js';
import { DuplicateListQuery, MergeInput, RejectInput } from './crm.schemas.js';
import { EntityResolutionService } from './entity-resolution.service.js';

const Id = new ParseUUIDPipe();

/** Duplicate review queue (docs/17 §40-45): medium/low-confidence matches wait here for a human decision. */
@Controller('duplicates')
export class DuplicatesController {
  constructor(
    private readonly query: CompanyQueryService,
    private readonly resolution: EntityResolutionService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('company.read')
  list(@Query(new ZodValidationPipe(DuplicateListQuery)) q: z.output<typeof DuplicateListQuery>, @CurrentAccess() access: Access) {
    return this.query.duplicates(access.workspaceId, q);
  }

  @Post(':id/merge')
  @RequirePermission('company.merge')
  async merge(@Param('id', Id) id: string, @Body(new ZodValidationPipe(MergeInput)) input: z.output<typeof MergeInput>, @CurrentAccess() access: Access) {
    const { merge, target } = await this.resolution.mergeCandidate(this.access.serviceContext(access), id, input);
    return { mergeId: merge.id, sourceId: merge.sourceId, filledFields: merge.filledFields, target: presentCompany(target) };
  }

  @Post(':id/reject')
  @RequirePermission('company.merge')
  async reject(@Param('id', Id) id: string, @Body(new ZodValidationPipe(RejectInput)) input: z.output<typeof RejectInput>, @CurrentAccess() access: Access) {
    const c = await this.resolution.rejectCandidate(this.access.serviceContext(access), id, input);
    return { id: c.id, status: c.status, resolution: c.resolution };
  }
}
