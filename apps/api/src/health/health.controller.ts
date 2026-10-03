import { Controller, Get } from '@nestjs/common';
import type { SystemHealth } from '@revenue-os/shared';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Phase 0 milestone check: Web → API → Postgres, and API → Redis → BullMQ → Worker. */
  @Get()
  check(): Promise<SystemHealth> {
    return this.health.check();
  }
}
