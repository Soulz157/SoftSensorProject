import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { PredictionJobAuthorizedService } from './prediction-job.authorized.service';
import { SubmitPredictionJobDto } from './dto/prediction-job.authorized.dto';

/**
 * MODEL-SERVE-003. User-facing: submit a batch job, poll its status.
 * `authorized/model/:modelId`, matching `ModelVersionAuthorizedController`'s
 * own prefix — same owner entity, same JWT caller.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class PredictionJobAuthorizedController {
  constructor(private readonly service: PredictionJobAuthorizedService) {}

  // NOT `/predict:batch` — Fastify's router (find-my-way) treats a bare `:`
  // as opening a param, so that path registers static `predict` plus a param
  // named `batch`. It happened to match `/predict:batch` (the literal colon
  // becomes the param's value) but ALSO matched `/predictXbatch`, i.e. any
  // `/predict<suffix>` — a silent routing hazard, not a working action-suffix
  // convention. Confirmed live against find-my-way@9.6.0 before switching to
  // this plain path.
  @Post('/predict-batch')
  submitController(
    @Param('modelId') modelId: string,
    @Body() dto: SubmitPredictionJobDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.submitPredictionJobService(modelId, dto, user);
  }

  @Get('/prediction-jobs/:jobId')
  getStatusController(
    @Param('modelId') modelId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getJobStatusService(modelId, jobId, user);
  }
}
