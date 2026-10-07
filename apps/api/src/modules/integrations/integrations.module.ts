import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { IntegrationService } from './integration.service.js';
import { IntegrationsController } from './integrations.controller.js';
import { PROVIDER_RUNTIME, providerRuntimeProvider } from './provider-runtime.js';

/** Integrations + Provider Gateway (Phase 5): connections, capability health, usage. */
@Module({
  imports: [AuthModule],
  controllers: [IntegrationsController],
  providers: [IntegrationService, GoogleOAuthService, providerRuntimeProvider],
  // One Provider Gateway per API process: other modules (campaigns) use this one, not their own.
  exports: [PROVIDER_RUNTIME],
})
export class IntegrationsModule {}
