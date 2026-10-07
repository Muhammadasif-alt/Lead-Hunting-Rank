import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CampaignsController, UnsubscribeController } from './campaigns.controller.js';
import { CampaignsQuery } from './campaigns.query.js';
import { CampaignsService } from './campaigns.service.js';

/** Campaigns + outreach (Phase 11): campaigns, prospects, dry runs, stop rules and the public unsubscribe endpoint. */
@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [CampaignsController, UnsubscribeController],
  providers: [CampaignsService, CampaignsQuery],
})
export class CampaignsModule {}
