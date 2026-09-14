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
  InferenceTruthRangeQueryDto,
  PutInferenceScheduleDto,
  RejoinInferenceTruthDto,
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

  /** MODEL-SERVE-005-T03. Live error over joined ground truth, with the
   *  coverage that makes it readable. */
  @Get('/inference/truth')
  getTruthController(
    @Param('modelId') modelId: string,
    @Query() query: InferenceTruthRangeQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getTruthService(modelId, query, user);
  }

  /** MODEL-SERVE-005-T03. Force a re-join over a range — the same sweeper
   *  path a scheduled join takes, never a second implementation. */
  @Post('/inference/truth/rejoin')
  rejoinTruthController(
    @Param('modelId') modelId: string,
    @Body() dto: RejoinInferenceTruthDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.rejoinTruthService(modelId, dto, user);
  }

  /** MODEL-SERVE-001-T10. One window's container stdout with the window's
   *  own facts attached, so a zero-line window can still say WHY it has no
   *  lines. `windowId` accepts the literal `latest`, which resolves to the
   *  model's most recent window — that is what keeps `models/views`'
   *  Console peek and `models/[id]`'s Logs tab on ONE endpoint and one
   *  shape. Lines are the NEWEST 500 (a FAILED window's failure is at the
   *  tail, not the head), returned oldest-first for display, every one of
   *  them URL-redacted. */
  @Get('/inference/windows/:windowId/logs')
  listLogsController(
    @Param('modelId') modelId: string,
    @Param('windowId') windowId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.listLogsService(modelId, windowId, user);
  }
}
