import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';

/**
 * Draft-scoped twin of `ModelRunLaunchAuthorizedController` (MODEL-FLOW-003)
 * — training against a `ModelDraft` before any `Model` row exists. Same
 * `authorized/model-drafts` prefix `ModelDraftAuthorizedController` uses for
 * the draft's own CRUD, not nested under `authorized/model`: these runs have
 * no model id to key a nested route on until Save Model adopts them.
 *
 * Lives in `ModelRunModule`, not `ModelDraftModule`: the artifact-validation
 * chain and container-spawn path already live in
 * `ModelRunLaunchAuthorizedService`, and duplicating them in the draft
 * module is exactly how the two would drift (see that service's own
 * `buildRunData` doc comment).
 */
@ApiBearerAuth()
@ApiTags('Model Training')
@Controller('authorized/model-drafts')
@UseGuards(JwtAccessGuard)
export class ModelDraftRunAuthorizedController {
  constructor(private readonly runs: ModelRunLaunchAuthorizedService) {}

  @Post('/:draftId/runs')
  @ApiOperation({
    summary:
      'Queue a training run against a ModelDraft and spawn its container',
    description:
      'Identical validation to the Model-scoped route — refuses (400) an ' +
      'artifact that is not FINAL, has no checksum, is not attached to a ' +
      'dataset, lacks the target column, or has too few rows to split. ' +
      'Creates NO Model row; the run is owned by the draft until Save ' +
      'Model adopts it.',
  })
  createDraftRunController(
    @Param('draftId') draftId: string,
    @Body() dto: CreateTrainingRunDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.createDraftRunService(draftId, dto, user.id, user.role);
  }

  @Get('/:draftId/runs')
  @ApiOperation({ summary: 'Runs for one ModelDraft, newest first' })
  listDraftRunsController(
    @Param('draftId') draftId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.listDraftRunsService(draftId, user.id, user.role);
  }

  @Get('/:draftId/runs/:runId')
  @ApiOperation({
    summary: 'One draft-scoped run with its log lines',
    description:
      "Includes the container's own logs (oldest first, capped at 500) so a " +
      'polling client needs one request per tick rather than two.',
  })
  getDraftRunController(
    @Param('draftId') draftId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.getDraftRunService(draftId, runId, user.id, user.role);
  }

  @Post('/:draftId/runs/:runId/cancel')
  @ApiOperation({ summary: 'Kill a queued or running draft-scoped container' })
  cancelDraftRunController(
    @Param('draftId') draftId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.cancelDraftRunService(draftId, runId, user.id, user.role);
  }
}
