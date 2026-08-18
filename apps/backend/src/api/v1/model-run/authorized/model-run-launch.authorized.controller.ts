import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';

/**
 * The USER-facing half of training runs — moved here from
 * `ModelAuthorizedController` (DS-LAKE model-run split): the routes and the
 * service that backs them now live in the same module, instead of the service
 * sitting in `model/` while borrowing this folder's DTO.
 *
 * Same `authorized/model` prefix as its container-facing twin in this folder,
 * so no URL changed. See `model-run.module.ts` for why they are separate.
 */
@ApiBearerAuth()
@ApiTags('Model Training')
@Controller('authorized/model')
@UseGuards(JwtAccessGuard)
export class ModelRunLaunchAuthorizedController {
  constructor(private readonly runs: ModelRunLaunchAuthorizedService) {}

  @Post('/:modelId/runs')
  @ApiOperation({
    summary: 'Queue a training run and spawn its container',
    description:
      "Resolves the dataset's committed FINAL artifact, mints a single-run " +
      'token, creates the run row, then starts the container out of band. ' +
      'Refuses (400) an artifact that is not FINAL, has no checksum, is not ' +
      'attached to a dataset, lacks the target column, or has too few rows ' +
      'to split — every one of those is a failure the container would ' +
      'otherwise discover minutes later, after a full parquet download.',
  })
  createRunController(
    @Param('modelId') modelId: string,
    @Body() dto: CreateTrainingRunDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.createRunService(modelId, dto, user.id, user.role);
  }

  @Get('/:modelId/runs')
  @ApiOperation({ summary: 'Runs for one model, newest first' })
  listRunsController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.listRunsService(modelId, user.id, user.role);
  }

  @Get('/:modelId/runs/:runId')
  @ApiOperation({
    summary: 'One run with its log lines',
    description:
      "Includes the container's own logs (oldest first, capped at 500) so a " +
      'polling client needs one request per tick rather than two.',
  })
  getRunController(
    @Param('modelId') modelId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.getRunService(modelId, runId, user.id, user.role);
  }

  @Post('/:modelId/runs/:runId/cancel')
  @ApiOperation({
    summary: 'Kill a queued or running container',
    description:
      'Invalidates the run token in the same write, so a container that ' +
      'survives the kill long enough to POST /complete cannot.',
  })
  cancelRunController(
    @Param('modelId') modelId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.cancelRunService(modelId, runId, user.id, user.role);
  }
}
