import { Controller, Get, HttpCode, Res, VERSION_NEUTRAL } from '@nestjs/common';
import type { Response } from 'express';
import type { SystemHealth } from '@revenue-os/shared';
import { RawResponse } from '../common/envelope.interceptor.js';
import { HealthService } from './health.service.js';

/** Infrastructure endpoints — version-neutral (/api/health…) and not wrapped in the data envelope. */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@RawResponse()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is up. No dependency checks — a Gmail/DB outage must not make the API look dead. */
  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'up' };
  }

  /** Readiness: can serve traffic (Postgres + Redis reachable). 503 otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.readiness();
    if (result.status !== 'up') res.status(503);
    return result;
  }

  /** Full diagnostics incl. a worker round trip — used by the web /diagnostics page. */
  @Get()
  check(): Promise<SystemHealth> {
    return this.health.check();
  }
}
