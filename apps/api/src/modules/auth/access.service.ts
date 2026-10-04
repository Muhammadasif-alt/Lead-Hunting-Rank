import { Injectable } from '@nestjs/common';
import {
  AuthorityExceededError,
  ForbiddenError,
  type AuthorityLimitKey,
  type PermissionKey,
  type RoleKey,
} from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import type { ServiceContext } from '../../domain/service-context.js';

/** Everything the server knows about what this user may do in this workspace (docs/14 §6-12 RequestContext). */
export interface Access {
  userId: string;
  workspaceId: string;
  memberId: string;
  roles: RoleKey[];
  permissions: ReadonlySet<PermissionKey>;
  /** Missing key = no authority. `null` = unlimited. */
  limits: ReadonlyMap<AuthorityLimitKey, number | null>;
}

export interface AuthorityDecision {
  allowed: boolean;
  code?: 'FORBIDDEN' | 'AUTHORITY_EXCEEDED';
  reason: string;
}

const allow = (reason: string): AuthorityDecision => ({ allowed: true, reason });
const deny = (code: AuthorityDecision['code'], reason: string): AuthorityDecision => ({ allowed: false, code, reason });

/**
 * Resolves membership → roles → effective permissions (deny wins) → authority limits, and answers authority
 * questions (docs/17 §21-25). This is the single server-side enforcement point; UI hiding is only UX.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws Forbidden unless the user is an ACTIVE member of the workspace — no cross-workspace access, ever. */
  async resolve(userId: string, workspaceId: string): Promise<Access> {
    const member = await this.prisma.client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: {
        workspace: { select: { status: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } },
        authorityLimits: true,
      },
    });
    if (!member || member.status !== 'ACTIVE' || member.workspace.status !== 'ACTIVE') {
      throw new ForbiddenError('You do not have access to this workspace');
    }

    const allowed = new Set<PermissionKey>();
    const denied = new Set<PermissionKey>();
    for (const { role } of member.roles) {
      for (const grant of role.permissions) {
        (grant.effect === 'DENY' ? denied : allowed).add(grant.permission.key as PermissionKey);
      }
    }
    for (const key of denied) allowed.delete(key); // Deny wins (docs/10 §15-19)

    const roleIds = member.roles.map((r) => r.roleId);
    const roleLimits = await this.prisma.client.authorityLimit.findMany({ where: { workspaceId, roleId: { in: roleIds } } });
    const limits = new Map<AuthorityLimitKey, number | null>();
    for (const l of roleLimits) {
      const key = l.key as AuthorityLimitKey;
      const value = l.maxValue === null ? null : Number(l.maxValue);
      const prev = limits.get(key);
      // Across roles the most generous applies; null (unlimited) beats any number.
      if (!limits.has(key) || value === null || (prev !== null && prev !== undefined && value > prev)) limits.set(key, value);
    }
    // A member-specific override replaces the role-derived limit (it may also restrict it).
    for (const l of member.authorityLimits) limits.set(l.key as AuthorityLimitKey, l.maxValue === null ? null : Number(l.maxValue));

    return {
      userId,
      workspaceId,
      memberId: member.id,
      roles: member.roles.map((r) => r.role.key),
      permissions: allowed,
      limits,
    };
  }

  can(access: Access, permission: PermissionKey): boolean {
    return access.permissions.has(permission);
  }

  /** Throws 403 FORBIDDEN when the permission is missing. */
  assert(access: Access, permission: PermissionKey): void {
    if (!this.can(access, permission)) throw new ForbiddenError(`Missing permission: ${permission}`, [{ path: 'permission', message: permission }]);
  }

  /** Throws 403 AUTHORITY_EXCEEDED when `value` is above this user's limit for `key`. */
  assertWithinLimit(access: Access, key: AuthorityLimitKey, value: number): void {
    const decision = this.withinLimit(access, key, value);
    if (!decision.allowed) throw new AuthorityExceededError(decision.reason, [{ path: key, message: decision.reason }]);
  }

  // ── Authority questions (docs/17 §21-25) ──

  canLaunchCampaign(access: Access, audienceSize: number): AuthorityDecision {
    if (!this.can(access, 'campaign.start')) return deny('FORBIDDEN', 'Launching campaigns needs the campaign.start permission');
    return this.withinLimit(access, 'campaign.max_audience', audienceSize);
  }

  /** Approving a commercial action, e.g. a discount. Permission first, then the authority limit. */
  canApprove(access: Access, action: { type: 'discount'; percent: number } | { type: 'general' }): AuthorityDecision {
    if (!this.can(access, 'approval.decide')) return deny('FORBIDDEN', 'Approving needs the approval.decide permission');
    if (action.type === 'discount') {
      if (!this.can(access, 'pricing.discount')) return deny('FORBIDDEN', 'Discounts need the pricing.discount permission');
      return this.withinLimit(access, 'pricing.max_discount_percent', action.percent);
    }
    return allow('Allowed');
  }

  canChangePolicy(access: Access): AuthorityDecision {
    return this.can(access, 'policy.manage') ? allow('Allowed') : deny('FORBIDDEN', 'Changing policy needs the policy.manage permission');
  }

  canResumeEmergencyStop(access: Access): AuthorityDecision {
    return this.can(access, 'outbound.resume')
      ? allow('Allowed')
      : deny('FORBIDDEN', 'Only an owner can resume outbound after an emergency stop');
  }

  /** Builds the context application services take, from a resolved access. */
  serviceContext(access: Access): ServiceContext {
    return { workspaceId: access.workspaceId, actor: { type: 'HUMAN', id: access.userId } };
  }

  private withinLimit(access: Access, key: AuthorityLimitKey, value: number): AuthorityDecision {
    if (!access.limits.has(key)) return deny('AUTHORITY_EXCEEDED', `No authority for ${key}`);
    const max = access.limits.get(key);
    if (max === null || max === undefined || value <= max) return allow(max === null ? 'Within limit (unlimited)' : `Within limit (max ${max})`);
    return deny('AUTHORITY_EXCEEDED', `${value} exceeds your limit of ${max} for ${key}`);
  }
}
