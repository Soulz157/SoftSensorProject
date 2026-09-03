import { Module } from '@nestjs/common';
import { TrainningContainerModule } from '../trainning-container/trainning-container.module';
import { ModelServingModule } from '../model-serving/model-serving.module';
import { PredictionJobAuthorizedController } from './authorized/prediction-job.authorized.controller';
import { PredictionJobCallbackAuthorizedController } from './authorized/prediction-job-callback.authorized.controller';
import { PredictionJobAuthorizedService } from './authorized/prediction-job.authorized.service';
import { PredictionJobTokenGuard } from '@/guards/prediction-job-token.guard';

@Module({
  imports: [TrainningContainerModule, ModelServingModule],
  controllers: [
    PredictionJobAuthorizedController,
    // MODEL-SERVE-003. Batch container callbacks — separate guard,
    // separate controller (see PredictionJobTokenGuard's doc comment).
    PredictionJobCallbackAuthorizedController,
  ],
  providers: [PredictionJobAuthorizedService, PredictionJobTokenGuard],
})
export class PredictionJobModule {}
