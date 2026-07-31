import { Module } from '@nestjs/common';
import { DataSourceAuthorizedController } from './authorized/data-source.authorized.controller';
import { DataSourceAuthorizedService } from './authorized/data-source.authorized.service';
import { DataSourceConnectService } from './authorized/data-source.connect.service';

@Module({
  controllers: [DataSourceAuthorizedController],
  providers: [DataSourceAuthorizedService, DataSourceConnectService],
})
export class DataSourceModule {}
