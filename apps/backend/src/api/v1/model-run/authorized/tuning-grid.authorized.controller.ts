import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { TuningGridAuthorizedService } from './tuning-grid.authorized.service';
import type { TuningGridResponse } from './tuning-grid.authorized.service';
import { ModelRetrainAuthorizedService } from './model-retrain.authorized.service';
import { TuningGridQueryDto } from './dto/tuning-grid.authorized.dto';

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
  constructor(
    private readonly tuningGrid: TuningGridAuthorizedService,
    private readonly retrain: ModelRetrainAuthorizedService,
  ) {}

  @Get('/tuning-grid/:algorithm')
  @ApiOperation({
    summary:
      'The curated hyperparameter variants Find Best Parameters searches for one algorithm',
  })
  async get(
    @Param('algorithm') algorithm: string,
    @Query() query: TuningGridQueryDto,
    @Users() user: Auth.UserPayload,
  ): Promise<TuningGridResponse> {
    // MODEL-FLOW-024. `modelId` asks for the figures a retrain of that Model
    // would inherit (editor access checked there); any figure sent beside it
    // wins, field by field.
    const fromModel = query.modelId
      ? await this.retrain.resolveTuningSizeService(
          query.modelId,
          algorithm,
          user,
        )
      : undefined;
    return this.tuningGrid.get(algorithm, {
      distinctLabelled: query.distinctLabelled ?? fromModel?.distinctLabelled,
      rows: query.rows ?? fromModel?.rows,
      features: query.features ?? fromModel?.features,
    });
  }
}
