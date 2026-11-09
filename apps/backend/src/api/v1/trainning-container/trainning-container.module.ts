import { Module } from '@nestjs/common';

import { ContainerDispatchService } from './authorized/container-dispatch.service';
import { TrainningContainerAuthorizedService } from './authorized/trainning-container.authorized.service';

@Module({
  providers: [TrainningContainerAuthorizedService, ContainerDispatchService],
  exports: [TrainningContainerAuthorizedService, ContainerDispatchService],
})
export class TrainningContainerModule {}
