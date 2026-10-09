import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsQuery } from './conversations.query.js';
import { ConversationsService } from './conversations.service.js';

/** Conversations + AI Inbox (Phase 12): threads, intelligence panel, replies, takeover and the inbox categories. */
@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsQuery],
})
export class ConversationsModule {}
