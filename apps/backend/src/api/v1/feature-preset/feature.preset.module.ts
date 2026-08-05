import { Module } from '@nestjs/common';
import { FeaturePresetAuthorizedController } from './authorized/feature.preset.authorized.controller';
import { FeaturePresetAuthorizedService } from './authorized/feature.preset.authorized.service';

@Module({
  controllers: [FeaturePresetAuthorizedController],
  providers: [FeaturePresetAuthorizedService],
})
export class FeaturePresetModule {}
