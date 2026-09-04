import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import {
  CreateTrainingRunDto,
  RunPredictionsBatchQueryDto,
} from './dto/model-run.authorized.dto';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';
import { ModelRunScoreAuthorizedService } from './model-run-score.authorized.service';

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
  constructor(
    private readonly runs: ModelRunLaunchAuthorizedService,
    private readonly scoring: ModelRunScoreAuthorizedService,
  ) {}

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

  // MODEL-FLOW-017-T03. Declared BEFORE `@Get('/:draftId/runs/:runId')` —
  // same "Nest/Fastify matches a literal segment before a parametric one"
  // convention `ModelDraftAuthorizedController` documents for its own
  // `@Get()` vs `@Get('/:id')` ordering. `runs/predictions/batch` is a
  // literal three-segment path and cannot be shadowed by `:runId` (which
  // matches ONE segment, not two), but this stays declared first anyway so
  // the file reads in the order Fastify's router actually resolves it.
  @Get('/:draftId/runs/predictions/batch')
  @ApiOperation({
    summary: 'Decimated actual/predicted series for N runs, one call',
    description:
      'MODEL-FLOW-017. Step 4 Model Selection’s overlay + small-multiple ' +
      'charts, never Step 5’s single full-width chart (that stays on ' +
      'GET .../runs/:runId/predictions, undecimated). A run that is not ' +
      'SUCCEEDED or has no predictions artifact contributes no series and ' +
      'is not an error; a run whose series cannot be read soft-fails on ' +
      'its own item.',
  })
  getDraftRunPredictionsBatchController(
    @Param('draftId') draftId: string,
    @Query() query: RunPredictionsBatchQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.getDraftRunPredictionsBatchService(
      draftId,
      query.runIds,
      user.id,
      user.role,
    );
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

  @Post('/:draftId/runs/:runId/score')
  @ApiOperation({
    summary: "Trigger a CV run's separate holdout-scoring phase",
    description:
      'MODEL-FLOW-016-T07. A CV run refuses (400) unless it is SUCCEEDED, ' +
      'is actually a Cross-Validation run (a non-CV run already scores ' +
      'its holdout inline during training), is not already being scored, ' +
      'and its dataset actually has a validation holdout. Mints a fresh ' +
      "token and spawns a scoring container out of band; poll the run's " +
      'own GET for `scoringContainerId` (in flight) / `predictionsKey` + ' +
      '`holdoutMetrics` (finished).',
  })
  triggerScoringController(
    @Param('draftId') draftId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.scoring.triggerScoringService(
      draftId,
      runId,
      user.id,
      user.role,
    );
  }

  @Get('/:draftId/runs/:runId/predictions')
  @ApiOperation({
    summary: "Parsed actual/predicted series for one run's test split",
    description:
      'MODEL-FLOW-004 — Step 4 Evaluation. Refuses (404) a run that has ' +
      'not SUCCEEDED or recorded no predictions artifact, naming which.',
  })
  getDraftRunPredictionsController(
    @Param('draftId') draftId: string,
    @Param('runId') runId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.runs.getDraftRunPredictionsService(
      draftId,
      runId,
      user.id,
      user.role,
    );
  }
}
