import { Module } from '@nestjs/common';
import { NodesPublicController } from './public/nodes.public.controller';
import { NodesPublicService } from './public/nodes.public.service';
import { NodesAuthorizedController } from './authorized/nodes.authorized.controller';
import { NodesAuthorizedService } from './authorized/nodes.authorized.service';
import { NodesAdminController } from './admin/nodes.admin.controller';
import { NodesAdminService } from './admin/nodes.admin.service';

@Module({
  controllers: [
    NodesPublicController,
    NodesAuthorizedController,
    NodesAdminController,
  ],
  providers: [NodesPublicService, NodesAuthorizedService, NodesAdminService],
})
export class NodesModule {}
