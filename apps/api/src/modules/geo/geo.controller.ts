import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { RequirePermission } from '../auth/auth.decorators.js';
import { GeoService } from './geo.service.js';

const CountryCode = new ZodValidationPipe(z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code'));
const CitiesQuery = z.object({ region: z.string().trim().min(1).max(120).optional() });

/**
 * Location pickers for the Lead Hunter (country → state/region → city). Reference data, no workspace data —
 * still behind login and market.read like the rest of the hunt screen.
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('countries')
  @RequirePermission('market.read')
  countries() {
    return { items: this.geo.listCountries() };
  }

  @Get('countries/:code/regions')
  @RequirePermission('market.read')
  regions(@Param('code', CountryCode) code: string) {
    return this.geo.listRegions(code);
  }

  @Get('countries/:code/cities')
  @RequirePermission('market.read')
  cities(@Param('code', CountryCode) code: string, @Query(new ZodValidationPipe(CitiesQuery)) q: z.output<typeof CitiesQuery>) {
    return { items: this.geo.listCities(code, q.region) };
  }
}
