import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiscoveryMissionsController, MarketsController } from './discovery.controller.js';
import { DiscoveryQueryService } from './discovery.query.js';
import { DiscoveryService } from './discovery.service.js';

/** Lead Hunter (Phase 7): markets and discovery missions — preview, start, pause, resume, stop, results. The worker runs the rounds. */
@Module({
  imports: [AuthModule],
  controllers: [DiscoveryMissionsController, MarketsController],
  providers: [DiscoveryService, DiscoveryQueryService],
})
export class DiscoveryModule {}
