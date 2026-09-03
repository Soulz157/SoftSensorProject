import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PredictionJobTokenGuard } from '@/guards/prediction-job-token.guard';
import { PredictionJobAuthorizedService } from './prediction-job.authorized.service';
import {
  PredictionJobCompleteDto,
  PredictionJobLogDto,
  PredictionJobUploadUrlsDto,
} from './dto/prediction-job.authorized.dto';

/**
 * MODEL-SERVE-003. The batch container's own callbacks — separate guard,
 * separate controller from `PredictionJobAuthorizedController`, mirroring
 * `ModelRunScoreAuthorizedController`'s split from `ModelRunAuthorizedController`
 * (see `PredictionJobTokenGuard`'s own doc comment for why reusing a JWT
 * guard or another entity's token guard here would be wrong).
 *
 * Route shape matches `RunContext.api` on the trainer side exactly:
 * `authorized/prediction-jobs/:jobId/batch-*`.
 */
@Controller('authorized/prediction-jobs')
@UseGuards(PredictionJobTokenGuard)
export class PredictionJobCallbackAuthorizedController {
  constructor(private readonly service: PredictionJobAuthorizedService) {}

  @Post('/:jobId/batch-claim')
  claimController(@Param('jobId') jobId: string) {
    return this.service.claimJobService(jobId);
  }

  @Post('/:jobId/batch-log')
  logController(
    @Param('jobId') jobId: string,
    @Body() dto: PredictionJobLogDto,
  ) {
    this.service.logService(jobId, dto);
    return { statusCode: 200, message: 'Logged', type: 'SUCCESS' as const };
  }

  @Post('/:jobId/batch-upload-urls')
  uploadUrlsController(
    @Param('jobId') jobId: string,
    @Body() dto: PredictionJobUploadUrlsDto,
  ) {
    return this.service.uploadUrlsService(jobId, dto);
  }

  @Post('/:jobId/batch-complete')
  completeController(
    @Param('jobId') jobId: string,
    @Body() dto: PredictionJobCompleteDto,
  ) {
    return this.service.completeJobService(jobId, dto);
  }
}
