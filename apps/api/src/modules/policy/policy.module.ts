import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PolicyController } from './policy.controller.js';
import { PolicyService } from './policy.service.js';

/** Policy Engine administration (Phase 10): kill switch, autonomy, rules, simulator, approvals, suppression. */
@Module({
  imports: [AuthModule],
  controllers: [PolicyController],
  providers: [PolicyService],
})
export class PolicyModule {}
