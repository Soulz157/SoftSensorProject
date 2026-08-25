import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { CreateFineTuningJobDto } from './dto/model-fine-tuning.authorized.dto';
import { ModelFineTuningAuthorizedService } from './model-fine-tuning.authorized.service';

/**
 * MODEL-FLOW-005. Draft-scoped, same `authorized/model-drafts` prefix
 * `ModelDraftRunAuthorizedController` uses for single runs — a fine-tuning
 * job has no model id to key a nested route on until Save Model adopts its
 * winning run, exactly the reasoning that controller's own doc comment
 * already gives for itself.
 */
@ApiBearerAuth()
@ApiTags('Model Fine-Tuning')
@Controller('authorized/model-drafts')
@UseGuards(JwtAccessGuard)
export class ModelFineTuningAuthorizedController {
  constructor(private readonly fineTuning: ModelFineTuningAuthorizedService) {}

  @Post('/:draftId/fine-tuning')
  @ApiOperation({
    summary: 'Start a hyperparameter search and launch its first run',
    description:
      'Fine-tuning = one algorithm/artifact/split, N hyperparameter sets ' +
      'tried in sequence, best kept by RMSE. Returns immediately with the ' +
      'job id; the search continues in the background as each child run ' +
      'completes. Refuses (409) a draft that already has a job in progress.',
  })
  createJobController(
    @Param('draftId') draftId: string,
    @Body() dto: CreateFineTuningJobDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.fineTuning.createJob(draftId, dto, user.id, user.role);
  }

  @Get('/:draftId/fine-tuning/:jobId')
  @ApiOperation({
    summary: 'One fine-tuning job — status, progress, and the best run so far',
    description:
      'Reconciles before returning: if the job’s current run finished ' +
      'but the job itself was not advanced yet, this read advances it first.',
  })
  getJobController(
    @Param('draftId') draftId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.fineTuning.getJobService(draftId, jobId, user.id, user.role);
  }

  @Post('/:draftId/fine-tuning/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a FAILED job’s last hyperparameter set',
    description:
      'Only a FAILED job can be retried. Relaunches the exact hyperparameter ' +
      'set that failed and resumes the search from there.',
  })
  retryJobController(
    @Param('draftId') draftId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.fineTuning.retryJobService(draftId, jobId, user.id, user.role);
  }
}
