import { Module } from '@nestjs/common';
import { ModelVersionAuthorizedController } from './authorized/model-version.authorized.controller';
import { ModelVersionAuthorizedService } from './authorized/model-version.authorized.service';

@Module({
  controllers: [ModelVersionAuthorizedController],
  providers: [ModelVersionAuthorizedService],
})
export class ModelVersionModule {}
