import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IntegrationService } from './integration.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { providerRuntimeProvider } from './provider-runtime.js';

/** Integrations + Provider Gateway (Phase 5): connections, capability health, usage. */
@Module({
  imports: [AuthModule],
  controllers: [IntegrationsController],
  providers: [IntegrationService, providerRuntimeProvider],
})
export class IntegrationsModule {}
