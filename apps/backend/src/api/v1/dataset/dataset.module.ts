import { Module } from '@nestjs/common';
import { DatasetAuthorizedController } from './authorized/dataset.authorized.controller';
import { DatasetAuthorizedService } from './authorized/dataset.authorized.service';

/**
 * Dataset CRUD only. Versions, stored rows and the cleaning-job runner live in
 * DatasetVersionModule — both mount under the same `authorized/dataset` prefix.
 */
@Module({
  controllers: [DatasetAuthorizedController],
  providers: [DatasetAuthorizedService],
})
export class DatasetModule {}
