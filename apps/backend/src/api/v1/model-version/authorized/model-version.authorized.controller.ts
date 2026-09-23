import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { ModelVersionAuthorizedService } from './model-version.authorized.service';
import {
  PromoteVersionDto,
  RollbackModelDto,
} from './dto/model-version.authorized.dto';

@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class ModelVersionAuthorizedController {
  constructor(private readonly service: ModelVersionAuthorizedService) {}

  // MODEL-SERVE-016-T01. The read that promote below has been missing since
  // the registry shipped — a client could move PRODUCTION to a version it
  // had no way to enumerate.
  @Get('/versions')
  listVersionsController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listVersionsService(user, modelId);
  }

  @Post('/versions/:version/promote')
  promoteVersionController(
    @Param('modelId') modelId: string,
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: PromoteVersionDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.promoteVersionService(user, modelId, version, dto);
  }

  // MODEL-SERVE-017-T01. Discard a version that never served. DELETE, not a
  // POST /discard, because the row really does go: there is no soft-delete
  // column on ModelVersion and adding one would make every existing read
  // (list, promote, rollback, the retrain comparison) responsible for
  // filtering a state it has never had to consider.
  @Delete('/versions/:version')
  removeVersionController(
    @Param('modelId') modelId: string,
    @Param('version', ParseIntPipe) version: number,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.removeVersionService(user, modelId, version);
  }

  @Post('/rollback')
  rollbackController(
    @Param('modelId') modelId: string,
    @Body() dto: RollbackModelDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.rollbackService(user, modelId, dto);
  }
}
