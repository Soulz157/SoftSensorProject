import { Module } from '@nestjs/common';
import { DataSourceAuthorizedController } from './authorized/data-source.authorized.controller';
import { DataSourceAuthorizedService } from './authorized/data-source.authorized.service';
import { DataSourceConnectService } from './authorized/data-source.connect.service';

@Module({
  controllers: [DataSourceAuthorizedController],
  providers: [DataSourceAuthorizedService, DataSourceConnectService],
  // MODEL-SERVE-001-T15. `ModelInputStatusAuthorizedService` reads live PI
  // tag quality for a model's feature tags through `tagsCurrentById`, which
  // already owns source resolution, the PI-only refusal, and credential
  // decryption — exported so that stays one implementation.
  exports: [DataSourceConnectService],
})
export class DataSourceModule {}
