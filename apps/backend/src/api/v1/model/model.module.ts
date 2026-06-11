import { Module } from '@nestjs/common';
import { ModelAuthorizedController } from './authorized/model.authorized.controller';
import { ModelAuthorizedService } from './authorized/model.authorized.service';

@Module({
  controllers: [ModelAuthorizedController],
  providers: [ModelAuthorizedService],
})
export class ModelModule {}
