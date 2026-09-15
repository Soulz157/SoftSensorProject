import { Module } from '@nestjs/common';
import { ModelVersionAuthorizedController } from './authorized/model-version.authorized.controller';
import { ModelVersionAuthorizedService } from './authorized/model-version.authorized.service';
import { ModelInputSchemaAuthorizedController } from './authorized/model-input-schema.authorized.controller';
import { ModelInputSchemaAuthorizedService } from './authorized/model-input-schema.authorized.service';
import { ModelInputStatusAuthorizedController } from './authorized/model-input-status.authorized.controller';
import { ModelInputStatusAuthorizedService } from './authorized/model-input-status.authorized.service';
import { DataSourceModule } from '@/api/v1/data-source/data-source.module';

@Module({
  // MODEL-SERVE-001-T15. `DataSourceConnectService` is reused rather than
  // re-implemented: it already resolves a saved source, refuses a non-PI
  // one, and decrypts its credentials. Duplicating that here would mean a
  // second copy of secret handling.
  imports: [DataSourceModule],
  controllers: [
    ModelVersionAuthorizedController,
    ModelInputSchemaAuthorizedController,
    ModelInputStatusAuthorizedController,
  ],
  providers: [
    ModelVersionAuthorizedService,
    ModelInputSchemaAuthorizedService,
    ModelInputStatusAuthorizedService,
  ],
})
export class ModelVersionModule {}
