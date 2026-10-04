import { Injectable } from '@nestjs/common';
import { provisionWorkspaceDefaults, type ActorType, type RoleKey } from '@revenue-os/database';
import { ConflictError, NotFoundError, ValidationError, normalizeEmail } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import { isUniqueViolation, writeAudit, type ServiceContext } from '../../domain/service-context.js';

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  owner: { email: string; name: string };
}

/** Workspaces, members and role assignment (docs/06 §4-9). */
@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a workspace with its default roles/pipeline/policies and an OWNER member — atomically. */
  async createWorkspace(actor: { type: ActorType; id: string | null }, input: CreateWorkspaceInput) {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG.test(slug)) throw new ValidationError('Slug must be 3–48 lowercase letters, digits or dashes', [{ path: 'slug', message: 'invalid' }]);
    const email = requireEmail(input.owner.email);

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({ data: { name: input.name.trim(), slug } });
        const roleIds = await provisionWorkspaceDefaults(tx, workspace.id);
        const user = await tx.user.upsert({
          where: { email },
          create: { email, name: input.owner.name.trim(), status: 'ACTIVE' },
          update: {},
        });
        const member = await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: user.id, status: 'ACTIVE' },
        });
        await tx.userRole.create({ data: { workspaceId: workspace.id, memberId: member.id, roleId: roleIds.OWNER } });

        const ctx: ServiceContext = { workspaceId: workspace.id, actor };
        await writeAudit(tx, ctx, { action: 'workspace.created', entityType: 'WORKSPACE', entityId: workspace.id, after: workspace });
        return { workspace, ownerUserId: user.id, ownerMemberId: member.id };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('ALREADY_EXISTS', `Workspace slug "${slug}" is taken`);
      throw err;
    }
  }

  /** Adds a person to the workspace with one role. New users start INVITED (they set a password in Phase 3). */
  async addMember(ctx: ServiceContext, input: { email: string; name: string; role: RoleKey }) {
    const email = requireEmail(input.email);
    return this.prisma.client.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { workspaceId_key: { workspaceId: ctx.workspaceId, key: input.role } } });
      if (!role) throw new NotFoundError(`Role ${input.role} not found in this workspace`);

      const user = await tx.user.upsert({ where: { email }, create: { email, name: input.name.trim() }, update: {} });
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: user.id } },
      });
      if (existing) throw new ConflictError('ALREADY_EXISTS', `${email} is already a member of this workspace`);

      const member = await tx.workspaceMember.create({
        data: { workspaceId: ctx.workspaceId, userId: user.id, status: user.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED' },
      });
      await tx.userRole.create({
        data: { workspaceId: ctx.workspaceId, memberId: member.id, roleId: role.id, createdBy: ctx.actor.type === 'HUMAN' ? ctx.actor.id : null },
      });
      await writeAudit(tx, ctx, {
        action: 'member.added',
        entityType: 'USER',
        entityId: user.id,
        after: { memberId: member.id, role: input.role },
      });
      return { userId: user.id, memberId: member.id };
    });
  }
}

function requireEmail(value: string): string {
  const email = normalizeEmail(value);
  if (!email) throw new ValidationError('Invalid email address', [{ path: 'email', message: 'invalid' }]);
  return email;
}
