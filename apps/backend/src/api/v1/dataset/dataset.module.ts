import { Module } from '@nestjs/common';
import { DatasetAuthorizedController } from './authorized/dataset.authorized.controller';
import { DatasetAuthorizedService } from './authorized/dataset.authorized.service';

@Module({
  controllers: [DatasetAuthorizedController],
  providers: [DatasetAuthorizedService],
})
export class DatasetModule {}
