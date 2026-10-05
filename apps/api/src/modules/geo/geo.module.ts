import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';

/** Country / region / city reference data for the location pickers. */
@Module({
  imports: [AuthModule],
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
