import { Module } from '@nestjs/common';
import { PredictionLogIngestAuthorizedController } from './authorized/prediction-log-ingest.authorized.controller';
import { PredictionLogAuthorizedController } from './authorized/prediction-log.authorized.controller';
import { PredictionLogAuthorizedService } from './authorized/prediction-log.authorized.service';
import { ServingTokenGuard } from '@/guards/serving-token.guard';

@Module({
  controllers: [
    PredictionLogIngestAuthorizedController,
    PredictionLogAuthorizedController,
  ],
  providers: [PredictionLogAuthorizedService, ServingTokenGuard],
})
export class PredictionLogModule {}
