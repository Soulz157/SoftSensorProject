import { Module } from '@nestjs/common';
import { TrainningContainerModule } from '../trainning-container/trainning-container.module';
import { ModelServingModule } from '../model-serving/model-serving.module';
import { InferenceWindowAuthorizedController } from './authorized/inference-window.authorized.controller';
import { InferenceWindowCallbackAuthorizedController } from './authorized/inference-window-callback.authorized.controller';
import { InferenceWindowAuthorizedService } from './authorized/inference-window.authorized.service';
import { InferenceWindowSchedulerService } from './authorized/inference-window-scheduler.service';
import { InferenceTruthSweeperService } from './authorized/inference-truth-sweeper.service';
import { InferenceWindowMonitoringService } from './authorized/inference-window-monitoring.authorized.service';
import { LivePredictDriverService } from './authorized/live-predict-driver.service';
import { InferenceWindowTokenGuard } from '@/guards/inference-window-token.guard';
import { ModelVersionModule } from '../model-version/model-version.module';

/**
 * MODEL-SERVE-006. `TrainningContainerModule` for `spawn`/`containerExists`;
 * `ModelServingModule` reused for the same reason `PredictionJobModule`
 * reuses it — one implementation of "how to build a model descriptor",
 * not a second that could drift.
 *
 * MODEL-SERVE-001-T25. `ModelVersionModule` for `ModelInputStatusAuthorized
 * Service` — the enable-time preflight runs T15's EXISTING live probe, which
 * already reads PI's snapshot path and resolves derived features' base tags
 * transitively. A second probe is what T25 forbids by name. Acyclic:
 * ModelVersionModule imports only DataSourceModule, which references this
 * module nowhere in code.
 */
@Module({
  imports: [TrainningContainerModule, ModelServingModule, ModelVersionModule],
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
    InferenceWindowMonitoringService,
    // MODEL-SERVE-008-T02. Its OWN sweep again, for the same reason the
    // truth sweeper has one: the scheduler tick inserts and reconciles and
    // nothing else. This driver never writes an InferenceWindow, never
    // spawns a container and never claims the scheduler's concurrency slot
    // — it reuses `InferenceWindowSchedulerService` only for
    // `asFetchConfig`/`resolveSource`, which are public precisely so a
    // second copy of the source mapping cannot drift from the first.
    LivePredictDriverService,
  ],
  // MODEL-SERVE-001-T17. First export this module has needed — Prediction
  // LogModule imports this module to read the window-plane drift/PSI
  // service, never the reverse: this module's own providers touch
  // TrainningContainerModule/ModelServingModule and neither of those
  // references PredictionLog in code, so the dependency direction stays
  // acyclic (verified: PredictionLog -> InferenceWindow ->
  // {TrainningContainer, ModelServing}).
  exports: [InferenceWindowMonitoringService],
})
export class InferenceWindowModule {}
