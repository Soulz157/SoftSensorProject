import { Module } from '@nestjs/common';
import { ModelServingAuthorizedController } from './authorized/model-serving.authorized.controller';
import { ModelServingAuthorizedService } from './authorized/model-serving.authorized.service';

@Module({
  controllers: [ModelServingAuthorizedController],
  providers: [ModelServingAuthorizedService],
  // MODEL-SERVE-003. PredictionJobModule reuses getDescriptorByVersionIdService
  // rather than re-deriving the presign/manifest/feature-spec chain a second
  // time — one implementation of "how to build a model descriptor", not two
  // that could drift.
  exports: [ModelServingAuthorizedService],
})
export class ModelServingModule {}
