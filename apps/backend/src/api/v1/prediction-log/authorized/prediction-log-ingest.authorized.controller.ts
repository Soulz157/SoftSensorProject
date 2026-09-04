import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ServingTokenGuard } from '@/guards/serving-token.guard';
import { PredictionLogAuthorizedService } from './prediction-log.authorized.service';
import { IngestPredictionLogDto } from './dto/prediction-log.authorized.dto';

/**
 * MODEL-SERVE-005-T01. `apps/serving`-facing only — same caller and same
 * guard as `ModelServingAuthorizedController`, in its own controller
 * because this feature's prefix (`authorized/serving`) is shared but its
 * module is not (see `PredictionLogAuthorizedService`'s own note on why
 * this stays a separate module).
 */
@Controller('authorized/serving')
@UseGuards(ServingTokenGuard)
export class PredictionLogIngestAuthorizedController {
  constructor(private readonly service: PredictionLogAuthorizedService) {}

  @Post('/predictions')
  ingestController(@Body() dto: IngestPredictionLogDto) {
    return this.service.ingestPredictionLogService(dto);
  }
}
