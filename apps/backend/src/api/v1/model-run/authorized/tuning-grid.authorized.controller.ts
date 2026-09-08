import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import type { TuningGridResponse } from './tuning-grid.authorized.service';

/**
 * MODEL-FLOW-022-T03b. Read-only — lets the client show the exact variants
 * a Find Best Parameters search will try, sourced from
 * `apps/backend/src/lib/tuning-grid.ts` rather than a client-side copy.
 */
@ApiBearerAuth()
@ApiTags('Model Training')
@Controller('authorized/training')
@UseGuards(JwtAccessGuard)
export class TuningGridAuthorizedController {
  constructor(private readonly tuningGrid: TuningGridAuthorizedService) {}

  @Get('/tuning-grid/:algorithm')
  @ApiOperation({
    summary:
      'The curated hyperparameter variants Find Best Parameters searches for one algorithm',
  })
  get(@Param('algorithm') algorithm: string): TuningGridResponse {
    return this.tuningGrid.get(algorithm);
  }
}
