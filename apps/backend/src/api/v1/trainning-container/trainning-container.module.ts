import { Module } from '@nestjs/common';

import { TrainningContainerAuthorizedService } from './authorized/trainning-container.authorized.service';

@Module({
  providers: [TrainningContainerAuthorizedService],
  exports: [TrainningContainerAuthorizedService],
})
export class TrainningContainerModule {}
