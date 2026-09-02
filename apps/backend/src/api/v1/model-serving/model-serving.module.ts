import { Module } from '@nestjs/common';
import { ModelServingAuthorizedController } from './authorized/model-serving.authorized.controller';
import { ModelServingAuthorizedService } from './authorized/model-serving.authorized.service';

@Module({
  controllers: [ModelServingAuthorizedController],
  providers: [ModelServingAuthorizedService],
})
export class ModelServingModule {}
