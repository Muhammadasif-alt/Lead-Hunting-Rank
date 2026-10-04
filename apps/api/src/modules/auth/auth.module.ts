import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DomainModule } from '../domain.module.js';
import { MembersController } from '../identity/members.controller.js';
import { MembersQuery } from '../identity/members.query.js';
import { AccessService } from './access.service.js';
import { AuthController } from './auth.controller.js';
import { AuthenticationGuard, CsrfGuard, PermissionGuard, ScopeGuard, WorkspaceGuard } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { LoginThrottleService } from './login-throttle.service.js';

/**
 * Authentication + RBAC (Phase 3). Global guards run in this order on every route:
 * CSRF → Authentication → Workspace → Permission → Scope. Routes are protected unless marked @Public().
 */
@Module({
  imports: [DomainModule],
  controllers: [AuthController, MembersController],
  providers: [
    AuthService,
    AccessService,
    LoginThrottleService,
    MembersQuery,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: WorkspaceGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
  exports: [AuthService, AccessService],
})
export class AuthModule {}
