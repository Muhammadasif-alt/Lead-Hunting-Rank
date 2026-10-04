import { Body, Controller, Get, Post } from '@nestjs/common';
import { ROLES } from '@revenue-os/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { MembersQuery } from './members.query.js';
import { WorkspaceService } from './workspace.service.js';

const AddMemberInput = z.strictObject({
  email: z.string().trim().min(3).max(320),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLES),
});

/** Team & Roles (screen #16) — list members of the current workspace; invite with member.manage. */
@Controller('workspace/members')
export class MembersController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly members: MembersQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  list(@CurrentAccess() access: Access) {
    return this.members.list(access.workspaceId);
  }

  @Post()
  @RequirePermission('member.manage')
  add(@Body(new ZodValidationPipe(AddMemberInput)) input: z.output<typeof AddMemberInput>, @CurrentAccess() access: Access) {
    // Only an owner may grant OWNER.
    if (input.role === 'OWNER') this.access.assert(access, 'workspace.manage');
    return this.workspaces.addMember(this.access.serviceContext(access), input);
  }
}
