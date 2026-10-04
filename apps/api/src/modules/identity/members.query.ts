import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';

/** Read model for the member list — keeps Prisma out of the controller. */
@Injectable()
export class MembersQuery {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const rows = await this.prisma.client.workspaceMember.findMany({
      where: { workspaceId, status: { not: 'REMOVED' } },
      select: {
        id: true,
        status: true,
        joinedAt: true,
        user: { select: { id: true, email: true, name: true, lastActiveAt: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({ ...m, roles: m.roles.map((r) => r.role) }));
  }
}
