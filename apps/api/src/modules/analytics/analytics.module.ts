import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsQuery } from './analytics.query.js';
import { AnalyticsService } from './analytics.service.js';

/** Analytics + Attribution (Phase 17): outcomes, attribution, economics, revenue events, saved views, ask. */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsQuery],
})
export class AnalyticsModule {}
