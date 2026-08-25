import { Module } from '@nestjs/common';
import { ModelRunAuthorizedController } from './authorized/model-run.authorized.controller';
import { ModelRunAuthorizedService } from './authorized/model-run.authorized.service';
import { RunTokenGuard } from '@/guards/run-token.guard';
import { TrainningContainerModule } from '../trainning-container/trainning-container.module';
import { ModelRunLaunchAuthorizedController } from './authorized/model-run-launch.authorized.controller';
import { ModelDraftRunAuthorizedController } from './authorized/model-draft-run.authorized.controller';
import { ModelRunLaunchAuthorizedService } from './authorized/model-run-launch.authorized.service';
import { ModelFineTuningAuthorizedController } from './authorized/model-fine-tuning.authorized.controller';
import { ModelFineTuningAuthorizedService } from './authorized/model-fine-tuning.authorized.service';

@Module({
  imports: [TrainningContainerModule],
  controllers: [
    ModelRunAuthorizedController,
    ModelRunLaunchAuthorizedController,
    // Draft-scoped twin (MODEL-FLOW-003) — training before a Model exists.
    ModelDraftRunAuthorizedController,
    // Hyperparameter search over draft-scoped runs (MODEL-FLOW-005).
    ModelFineTuningAuthorizedController,
  ],
  providers: [
    ModelRunLaunchAuthorizedService,
    ModelRunAuthorizedService,
    ModelFineTuningAuthorizedService,
    RunTokenGuard,
  ],
})
export class ModelRunModule {}
