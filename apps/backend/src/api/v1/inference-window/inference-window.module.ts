import { Module } from '@nestjs/common';
import { TrainningContainerModule } from '../trainning-container/trainning-container.module';
import { ModelServingModule } from '../model-serving/model-serving.module';
import { InferenceWindowAuthorizedController } from './authorized/inference-window.authorized.controller';
import { InferenceWindowCallbackAuthorizedController } from './authorized/inference-window-callback.authorized.controller';
import { InferenceWindowAuthorizedService } from './authorized/inference-window.authorized.service';
import { InferenceWindowSchedulerService } from './authorized/inference-window-scheduler.service';
import { InferenceTruthSweeperService } from './authorized/inference-truth-sweeper.service';
import { InferenceWindowTokenGuard } from '@/guards/inference-window-token.guard';

/**
 * MODEL-SERVE-006. `TrainningContainerModule` for `spawn`/`containerExists`;
 * `ModelServingModule` reused for the same reason `PredictionJobModule`
 * reuses it — one implementation of "how to build a model descriptor",
 * not a second that could drift.
 */
@Module({
  imports: [TrainningContainerModule, ModelServingModule],
  controllers: [
    InferenceWindowAuthorizedController,
    InferenceWindowCallbackAuthorizedController,
  ],
  providers: [
    InferenceWindowAuthorizedService,
    InferenceWindowSchedulerService,
    // MODEL-SERVE-005-T03. Its OWN sweep, not part of the scheduler tick —
    // MODEL-SERVE-006-T02's rule is that the tick inserts and reconciles
    // and nothing else.
    InferenceTruthSweeperService,
    InferenceWindowTokenGuard,
  ],
})
export class InferenceWindowModule {}
