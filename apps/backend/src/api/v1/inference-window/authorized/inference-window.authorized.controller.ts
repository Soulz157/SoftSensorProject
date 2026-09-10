import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { InferenceWindowAuthorizedService } from './inference-window.authorized.service';
import {
  BackfillInferenceWindowsDto,
  PutInferenceScheduleDto,
} from './dto/inference-window.authorized.dto';

/**
 * MODEL-SERVE-006. `authorized/model/:modelId`, matching
 * `ModelVersionAuthorizedController`/`PredictionLogAuthorizedController`'s
 * own shared prefix — same owner entity, same JWT caller, disambiguated by
 * the `inference/` sub-path.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class InferenceWindowAuthorizedController {
  constructor(private readonly service: InferenceWindowAuthorizedService) {}

  @Get('/inference/schedule')
  getScheduleController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getScheduleService(modelId, user);
  }

  @Put('/inference/schedule')
  putScheduleController(
    @Param('modelId') modelId: string,
    @Body() dto: PutInferenceScheduleDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.putScheduleService(modelId, dto, user);
  }

  @Get('/inference/windows')
  listWindowsController(
    @Param('modelId') modelId: string,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listWindowsService(modelId, { status, from, to }, user);
  }

  @Get('/inference/status')
  getStatusController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getStatusService(modelId, user);
  }

  @Post('/inference/backfill')
  backfillController(
    @Param('modelId') modelId: string,
    @Body() dto: BackfillInferenceWindowsDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.backfillService(modelId, dto, user);
  }

  @Post('/inference/windows/:windowId/retry')
  retryController(
    @Param('modelId') modelId: string,
    @Param('windowId') windowId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.retryService(modelId, windowId, user);
  }

  @Get('/inference/windows/:windowId/logs')
  listLogsController(
    @Param('modelId') modelId: string,
    @Param('windowId') windowId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listLogsService(modelId, windowId, user);
  }
}
