import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';

/** AI runtime administration (Phase 9): agent registry, today's usage, recent decisions. */
@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
