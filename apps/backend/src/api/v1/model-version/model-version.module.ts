import { Module } from '@nestjs/common';
import { ModelVersionAuthorizedController } from './authorized/model-version.authorized.controller';
import { ModelVersionAuthorizedService } from './authorized/model-version.authorized.service';
import { ModelInputSchemaAuthorizedController } from './authorized/model-input-schema.authorized.controller';
import { ModelInputSchemaAuthorizedService } from './authorized/model-input-schema.authorized.service';

@Module({
  controllers: [
    ModelVersionAuthorizedController,
    ModelInputSchemaAuthorizedController,
  ],
  providers: [ModelVersionAuthorizedService, ModelInputSchemaAuthorizedService],
})
export class ModelVersionModule {}
