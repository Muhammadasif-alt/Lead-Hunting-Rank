import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SignalsController } from './signals.controller.js';
import { SignalsQuery } from './signals.query.js';
import { SignalsService } from './signals.service.js';

/** Signals + Intent (Phase 16): signal queue, watchlists, rules, company signals, analytics, search. */
@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [SignalsController],
  providers: [SignalsService, SignalsQuery],
})
export class SignalsModule {}
