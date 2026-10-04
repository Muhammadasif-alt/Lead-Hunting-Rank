import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { IntegrationService } from './integration.service.js';

const ConnectInput = z.strictObject({ name: z.string().trim().min(1).max(120).optional() });
const UsageQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
const ProviderKey = new ZodValidationPipe(z.string().regex(/^[a-z0-9_]{1,64}$/, 'invalid provider key'));

/** Integrations (screen #15, docs/12 §148). Reading needs integration.read; changing anything needs integration.manage. */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('integration.read')
  list(@CurrentAccess() access: Access) {
    return this.integrations.list(access.workspaceId);
  }

  @Get('catalog')
  @RequirePermission('integration.read')
  catalog() {
    return this.integrations.catalog();
  }

  @Get('usage')
  @RequirePermission('integration.read')
  usage(@Query(new ZodValidationPipe(UsageQuery)) query: z.output<typeof UsageQuery>, @CurrentAccess() access: Access) {
    return this.integrations.usage(access.workspaceId, query.days);
  }

  @Post(':provider/connect')
  @RequirePermission('integration.manage')
  connect(@Param('provider', ProviderKey) provider: string, @Body(new ZodValidationPipe(ConnectInput)) input: z.output<typeof ConnectInput>, @CurrentAccess() access: Access) {
    return this.integrations.connect(this.access.serviceContext(access), provider, input);
  }

  @Post(':id/test')
  @RequirePermission('integration.manage')
  test(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.integrations.test(this.access.serviceContext(access), id);
  }

  @Post(':id/disable')
  @RequirePermission('integration.manage')
  disable(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.integrations.disable(this.access.serviceContext(access), id);
  }

  @Post(':id/enable')
  @RequirePermission('integration.manage')
  enable(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.integrations.enable(this.access.serviceContext(access), id);
  }

  @Delete(':id')
  @RequirePermission('integration.manage')
  disconnect(@Param('id', new ParseUUIDPipe()) id: string, @CurrentAccess() access: Access) {
    return this.integrations.disconnect(this.access.serviceContext(access), id);
  }
}
