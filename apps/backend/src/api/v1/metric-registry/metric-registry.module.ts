import { Module } from '@nestjs/common';
import { MetricRegistryAuthorizedController } from './authorized/metric-registry.authorized.controller';

@Module({
  controllers: [MetricRegistryAuthorizedController],
})
export class MetricRegistryModule {}
