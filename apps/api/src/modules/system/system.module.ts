import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PipelineService } from './pipeline.service.js';
import { SystemController } from './system.controller.js';

/** System Health (Phase 4): event pipeline, queues, workers and the dead-letter queue. */
@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [PipelineService],
})
export class SystemModule {}
