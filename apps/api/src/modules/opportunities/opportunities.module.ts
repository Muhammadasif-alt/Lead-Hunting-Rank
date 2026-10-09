import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesQuery } from './opportunities.query.js';
import { OpportunitiesService } from './opportunities.service.js';

/** Qualification + opportunities (Phase 13): board, Opportunity 360, stage commands, won / lost, stakeholders. */
@Module({
  imports: [AuthModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesQuery, OpportunitiesService],
})
export class OpportunitiesModule {}
