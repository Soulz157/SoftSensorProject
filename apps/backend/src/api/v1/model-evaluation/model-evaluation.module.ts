import { Module } from '@nestjs/common';
import { ModelServingModule } from '../model-serving/model-serving.module';
import { InferenceWindowModule } from '../inference-window/inference-window.module';
import { ModelEvaluationAuthorizedController } from './authorized/model-evaluation.authorized.controller';
import { ModelEvaluationAuthorizedService } from './authorized/model-evaluation.authorized.service';
import { ModelEvaluationAccessService } from './authorized/model-evaluation-access.service';
import { WriteBackAuthorizedController } from './authorized/write-back.authorized.controller';
import { PiRollbackAuthorizedService } from './authorized/pi-rollback.authorized.service';
import { PiWriteBackAuthorizedService } from './authorized/pi-write-back.authorized.service';
import { WriteBackConfigAuthorizedService } from './authorized/write-back-config.authorized.service';

/**
 * MODEL-SERVE-032. `ModelServingModule` for the descriptor (feature columns +
 * target), `InferenceWindowModule` for the scheduler's `asFetchConfig` /
 * `resolveSource`. Both are one-way imports: neither references this module.
 */
@Module({
  imports: [ModelServingModule, InferenceWindowModule],
  controllers: [
    ModelEvaluationAuthorizedController,
    WriteBackAuthorizedController,
  ],
  providers: [
    ModelEvaluationAuthorizedService,
    ModelEvaluationAccessService,
    WriteBackConfigAuthorizedService,
    PiWriteBackAuthorizedService,
    PiRollbackAuthorizedService,
  ],
})
export class ModelEvaluationModule {}
