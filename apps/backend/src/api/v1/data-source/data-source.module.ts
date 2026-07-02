import { Module } from '@nestjs/common';
import { DataSourceAuthorizedController } from './authorized/data-source.authorized.controller';
import { DataSourceAuthorizedService } from './authorized/data-source.authorized.service';

@Module({
  controllers: [DataSourceAuthorizedController],
  providers: [DataSourceAuthorizedService],
})
export class DataSourceModule {}
