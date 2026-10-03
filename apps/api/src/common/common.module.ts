import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { EnvelopeInterceptor } from './envelope.interceptor.js';

/** Cross-cutting HTTP behaviour applied to every endpoint: error envelope + success envelope. */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class CommonModule {}
