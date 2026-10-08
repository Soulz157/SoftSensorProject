import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { PredictionLogAuthorizedService } from './prediction-log.authorized.service';
import { PredictionLogRangeQueryDto } from './dto/prediction-log.authorized.dto';

/**
 * MODEL-SERVE-005. `authorized/model/:modelId`, matching model-version/
 * prediction-job/model-retrain's own prefix — same owner entity, same JWT
 * caller. Ingest lives in a separate controller under `authorized/serving`
 * (a different guard, a different caller) — see that file's own note.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class PredictionLogAuthorizedController {
  constructor(private readonly service: PredictionLogAuthorizedService) {}

  @Get('/predictions')
  getPredictionsController(
    @Param('modelId') modelId: string,
    @Query() query: PredictionLogRangeQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getPredictionSeriesService(modelId, query, user);
  }

  // MODEL-SERVE-001-T13. The only input-drift route since MODEL-SERVE-028
  // removed the z-score `/drift` and `/live-drift`. A caller passes whatever
  // [from, to] it wants; the wider window this metric needs to clear its
  // sample floor is a client-side default range.
  @Get('/psi')
  getPsiController(
    @Param('modelId') modelId: string,
    @Query() query: PredictionLogRangeQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getPsiService(modelId, query, user);
  }
}
