import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { AiService } from './ai.service.js';

const AgentTypeParam = new ZodValidationPipe(z.enum(['RESEARCH', 'WEB_AUDIT', 'CONTACT', 'SCORING', 'CAMPAIGN']));
const UpdateAgentInput = z
  .strictObject({ enabled: z.boolean().optional(), dailyRunLimit: z.number().int().min(0).max(1_000_000).nullable().optional() })
  .refine((v) => v.enabled !== undefined || v.dailyRunLimit !== undefined, 'Nothing to change');

/** AI agents (docs/08 §12-13, screen #17). Reading: everyone with policy.read; changing: policy.manage (owner, admin). */
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly access: AccessService,
  ) {}

  @Get('agents')
  @RequirePermission('policy.read')
  agents(@CurrentAccess() access: Access) {
    return this.ai.agents(access.workspaceId);
  }

  @Patch('agents/:type')
  @RequirePermission('policy.manage')
  update(@Param('type', AgentTypeParam) type: 'RESEARCH' | 'WEB_AUDIT' | 'CONTACT' | 'SCORING' | 'CAMPAIGN', @Body(new ZodValidationPipe(UpdateAgentInput)) input: z.output<typeof UpdateAgentInput>, @CurrentAccess() access: Access) {
    return this.ai.update(this.access.serviceContext(access), type, input);
  }
}
