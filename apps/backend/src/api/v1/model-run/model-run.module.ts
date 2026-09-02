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

@Module({
  imports: [TrainningContainerModule],
  controllers: [
    ModelRunAuthorizedController,
    ModelRunLaunchAuthorizedController,
    // Draft-scoped twin (MODEL-FLOW-003) — training before a Model exists.
    ModelDraftRunAuthorizedController,
    // Hyperparameter search / algorithm sweep over draft-scoped runs
    // (MODEL-FLOW-005, generalized by MODEL-FLOW-013).
    ModelCandidateJobAuthorizedController,
    // MODEL-FLOW-016-T07. Scoring container callbacks — separate guard,
    // separate controller (see ScoreTokenGuard's doc comment).
    ModelRunScoreAuthorizedController,
  ],
  providers: [
    ModelRunLaunchAuthorizedService,
    ModelRunAuthorizedService,
    ModelCandidateJobAuthorizedService,
    ModelRunScoreAuthorizedService,
    RunTokenGuard,
    ScoreTokenGuard,
  ],
})
export class ModelRunModule {}
