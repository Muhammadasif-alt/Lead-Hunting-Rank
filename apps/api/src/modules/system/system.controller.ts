import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { PipelineService } from './pipeline.service.js';

const PipelineTestInput = z.strictObject({
  simulate: z.enum(['rate-limit', 'unavailable', 'lost-response']).optional(),
});
const IgnoreInput = z.strictObject({ note: z.string().trim().max(500).optional() });
const DeadLetterQuery = z.object({ status: z.enum(['OPEN', 'RETRY_SCHEDULED', 'RESOLVED', 'IGNORED']).optional() });

/** System Health (screen #18): event pipeline, workers, queues and failed jobs. */
@Controller('system')
export class SystemController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly access: AccessService,
  ) {}

  @Get('pipeline')
  @RequirePermission('system.read')
  overview(@CurrentAccess() access: Access) {
    return this.pipeline.overview(access.workspaceId);
  }

  @Post('pipeline/test')
  @RequirePermission('system.manage')
  test(@Body(new ZodValidationPipe(PipelineTestInput)) input: z.output<typeof PipelineTestInput>, @CurrentAccess() access: Access) {
    return this.pipeline.runPipelineTest(this.access.serviceContext(access), input.simulate);
  }

  @Get('external-actions/:id')
  @RequirePermission('system.read')
  externalAction(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.pipeline.externalAction(access.workspaceId, id);
  }

  @Get('dead-letters')
  @RequirePermission('system.read')
  deadLetters(@Query(new ZodValidationPipe(DeadLetterQuery)) query: z.output<typeof DeadLetterQuery>, @CurrentAccess() access: Access) {
    return this.pipeline.listDeadLetters(access.workspaceId, query.status);
  }

  @Post('dead-letters/:id/retry')
  @RequirePermission('system.manage')
  retry(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.pipeline.retryDeadLetter(this.access.serviceContext(access), id);
  }

  @Post('dead-letters/:id/ignore')
  @RequirePermission('system.manage')
  ignore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(IgnoreInput)) input: z.output<typeof IgnoreInput>,
    @CurrentAccess() access: Access,
  ) {
    return this.pipeline.ignoreDeadLetter(this.access.serviceContext(access), id, input.note);
  }
}
