import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeQuery } from './knowledge.query.js';
import { KnowledgeService } from './knowledge.service.js';
import { MemoryController } from './memory.controller.js';
import { MemoryQuery } from './memory.query.js';

/** Memory + Knowledge (Phase 15): the Business Brain, sales memory, commitments, relationships, AI context. */
@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [KnowledgeController, MemoryController],
  providers: [KnowledgeService, KnowledgeQuery, MemoryQuery],
})
export class KnowledgeModule {}
