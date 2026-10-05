import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { DiscoveryQueryService } from './discovery.query.js';
import { MissionCompaniesQuery, MissionListQuery, MissionVersionInput, PreviewMissionInput, StartMissionInput } from './discovery.schemas.js';
import { DiscoveryService } from './discovery.service.js';

const Id = new ParseUUIDPipe();

/**
 * Lead Hunter — discovery missions (screen #3, docs/17 §46-51). Reads need market.read; anything that starts or
 * steers a hunt (it spends provider budget) needs market.run. Lifecycle changes are explicit commands.
 */
@Controller('discovery-missions')
export class DiscoveryMissionsController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly query: DiscoveryQueryService,
    private readonly access: AccessService,
  ) {}

  /** What a hunt would do — market, depth, sources, strategies. Writes nothing. */
  @Post('preview')
  @HttpCode(200)
  @RequirePermission('market.read')
  preview(@Body(new ZodValidationPipe(PreviewMissionInput)) input: PreviewMissionInput, @CurrentAccess() access: Access) {
    return this.discovery.preview(this.access.serviceContext(access), input);
  }

  /** Starts a mission; the worker picks it up from the outbox event. */
  @Post()
  @HttpCode(202)
  @RequirePermission('market.run')
  async start(@Body(new ZodValidationPipe(StartMissionInput)) input: StartMissionInput, @CurrentAccess() access: Access) {
    return { mission: await this.discovery.start(this.access.serviceContext(access), input) };
  }

  @Get()
  @RequirePermission('market.read')
  list(@Query(new ZodValidationPipe(MissionListQuery)) q: z.output<typeof MissionListQuery>, @CurrentAccess() access: Access) {
    return this.query.list(access.workspaceId, q);
  }

  @Get(':id')
  @RequirePermission('market.read')
  detail(@Param('id', Id) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id, access.permissions);
  }

  @Get(':id/companies')
  @RequirePermission('market.read')
  companies(@Param('id', Id) id: string, @Query(new ZodValidationPipe(MissionCompaniesQuery)) q: MissionCompaniesQuery, @CurrentAccess() access: Access) {
    return this.query.companies(access.workspaceId, id, q);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('market.run')
  pause(@Param('id', Id) id: string, @Body(new ZodValidationPipe(MissionVersionInput)) input: z.output<typeof MissionVersionInput>, @CurrentAccess() access: Access) {
    return this.discovery.pause(this.access.serviceContext(access), id, input.version);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('market.run')
  resume(@Param('id', Id) id: string, @Body(new ZodValidationPipe(MissionVersionInput)) input: z.output<typeof MissionVersionInput>, @CurrentAccess() access: Access) {
    return this.discovery.resume(this.access.serviceContext(access), id, input.version);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequirePermission('market.run')
  stop(@Param('id', Id) id: string, @Body(new ZodValidationPipe(MissionVersionInput)) input: z.output<typeof MissionVersionInput>, @CurrentAccess() access: Access) {
    return this.discovery.stop(this.access.serviceContext(access), id, input.version);
  }
}

/** Markets the workspace hunts in (market ≠ search: one market, many missions over time). */
@Controller('markets')
export class MarketsController {
  constructor(private readonly query: DiscoveryQueryService) {}

  @Get()
  @RequirePermission('market.read')
  list(@CurrentAccess() access: Access) {
    return this.query.markets(access.workspaceId);
  }
}
