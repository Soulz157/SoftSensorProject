import { Module } from '@nestjs/common';
import { ModelRunAuthorizedController } from './authorized/model-run.authorized.controller';
import { ModelRunAuthorizedService } from './authorized/model-run.authorized.service';
import { RunTokenGuard } from '@/guards/run-token.guard';
import { ScoreTokenGuard } from '@/guards/score-token.guard';
import { TrainningContainerModule } from '../trainning-container/trainning-container.module';
import { ModelRunLaunchAuthorizedController } from './authorized/model-run-launch.authorized.controller';
import { ModelDraftRunAuthorizedController } from './authorized/model-draft-run.authorized.controller';
import { ModelRunLaunchAuthorizedService } from './authorized/model-run-launch.authorized.service';
import { ModelRunScoreAuthorizedController } from './authorized/model-run-score.authorized.controller';
import { ModelRunScoreAuthorizedService } from './authorized/model-run-score.authorized.service';
import { ModelCandidateJobAuthorizedController } from './authorized/model-candidate-job.authorized.controller';
import { ModelCandidateJobAuthorizedService } from './authorized/model-candidate-job.authorized.service';
import { ModelRetrainAuthorizedController } from './authorized/model-retrain.authorized.controller';
import { ModelRetrainAuthorizedService } from './authorized/model-retrain.authorized.service';
import { TuningGridAuthorizedController } from './authorized/tuning-grid.authorized.controller';
import { TuningGridAuthorizedService } from './authorized/tuning-grid.authorized.service';

@Module({
  imports: [TrainningContainerModule],
  controllers: [
    ModelRunAuthorizedController,
    ModelRunLaunchAuthorizedController,
    ModelDraftRunAuthorizedController,
    ModelCandidateJobAuthorizedController,
    // Model instead of a draft — a retrain. Its own controller because the
    // prefix (`authorized/model/:modelId`) and the authorization rule
    // (editor access on the Model) differ from the draft-scoped one.
    ModelRetrainAuthorizedController,
    // MODEL-FLOW-016-T07. Scoring container callbacks — separate guard,
    // separate controller (see ScoreTokenGuard's doc comment).
    ModelRunScoreAuthorizedController,
    // MODEL-FLOW-022-T03b. Read-only view of tuning-grid.ts for the client's
    // Find Best Parameters variant list — no draft/model scoping needed.
    TuningGridAuthorizedController,
  ],
  providers: [
    ModelRunLaunchAuthorizedService,
    ModelRunAuthorizedService,
    ModelCandidateJobAuthorizedService,
    ModelRetrainAuthorizedService,
    ModelRunScoreAuthorizedService,
    TuningGridAuthorizedService,
    RunTokenGuard,
    ScoreTokenGuard,
  ],
})
export class ModelRunModule {}
