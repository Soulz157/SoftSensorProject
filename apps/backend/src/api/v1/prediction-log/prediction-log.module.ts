import { Module } from '@nestjs/common';
import { PredictionLogIngestAuthorizedController } from './authorized/prediction-log-ingest.authorized.controller';
import { PredictionLogAuthorizedController } from './authorized/prediction-log.authorized.controller';
import { PredictionLogAuthorizedService } from './authorized/prediction-log.authorized.service';
import { ServingTokenGuard } from '@/guards/serving-token.guard';
import { InferenceWindowModule } from '@/api/v1/inference-window/inference-window.module';

/**
 * MODEL-SERVE-001-T17. `InferenceWindowModule` for `InferenceWindowMonitor
 * ingService` — the window-plane drift/PSI reader `getDriftService`/
 * `getPsiService` dispatch to for a model with an `InferenceSchedule`. The
 * dependency runs this direction only: `InferenceWindowModule`'s own
 * providers (`TrainningContainerModule`/`ModelServingModule`) reference
 * nothing in this module, so this import does not close a cycle.
 */
@Module({
  imports: [InferenceWindowModule],
  controllers: [
    PredictionLogIngestAuthorizedController,
    PredictionLogAuthorizedController,
  ],
  providers: [PredictionLogAuthorizedService, ServingTokenGuard],
})
export class PredictionLogModule {}
