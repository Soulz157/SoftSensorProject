import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelRetrainAuthorizedService } from './model-retrain.authorized.service';
import { TriggerRetrainDto } from './dto/model-retrain.authorized.dto';

/**
 * MODEL-SERVE-004. `authorized/model/:modelId`, matching
 * `ModelVersionAuthorizedController` and `PredictionJobAuthorizedController`
 * — same owner entity, same JWT caller. The wizard's own candidate-job routes
 * stay where they are (`authorized/model-drafts/:draftId/candidate-jobs`):
 * one job table, two owners, two prefixes, and the prefix is what decides
 * which authorization rule applies.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class ModelRetrainAuthorizedController {
  constructor(private readonly service: ModelRetrainAuthorizedService) {}

  // A plain path, not `/retrain:trigger` or similar — see
  // PredictionJobAuthorizedController's own note on find-my-way treating a
  // bare `:` as opening a param and matching any `/<static><suffix>`.
  @Post('/retrain')
  triggerController(
    @Param('modelId') modelId: string,
    @Body() dto: TriggerRetrainDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.triggerRetrainService(modelId, dto, user);
  }

  @Get('/retrain/:jobId')
  getJobController(
    @Param('modelId') modelId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getRetrainJobService(modelId, jobId, user);
  }
}
