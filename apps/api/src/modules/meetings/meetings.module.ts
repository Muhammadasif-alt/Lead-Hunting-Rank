import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsQuery } from './meetings.query.js';
import { MeetingsService } from './meetings.service.js';

/** Calendar + meetings (Phase 14): availability, booking through the calendar, briefs, outcomes, setup. */
@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingsQuery],
})
export class MeetingsModule {}
