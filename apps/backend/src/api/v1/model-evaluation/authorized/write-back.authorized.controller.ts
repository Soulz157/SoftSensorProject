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
import { WriteBackConfigAuthorizedService } from './write-back-config.authorized.service';
import { PiWriteBackAuthorizedService } from './pi-write-back.authorized.service';
import { PiRollbackAuthorizedService } from './pi-rollback.authorized.service';
import {
  PutWriteBackConfigDto,
  RollbackDto,
  WriteBackDto,
  WriteBackHistoryQueryDto,
} from './dto/model-evaluation.authorized.dto';

/**
 * MODEL-SERVE-032. PI write-back, under `authorized/model/:modelId`.
 *
 * Authorization is decided INSIDE each service method, per route: the read
 * routes here answer to monitoring access, the mutating ones to
 * `assertWriteBack` (workspace owner / admin). Nothing is class-level,
 * because a class-level role guard would cover both kinds at once.
 */
@Controller('authorized/model/:modelId')
@UseGuards(JwtAccessGuard)
export class WriteBackAuthorizedController {
  constructor(
    private readonly config: WriteBackConfigAuthorizedService,
    private readonly writer: PiWriteBackAuthorizedService,
    private readonly rollback: PiRollbackAuthorizedService,
  ) {}

  @Get('/evaluation/writeback/config')
  getConfigController(
    @Param('modelId') modelId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.config.getConfigService(modelId, user);
  }

  @Put('/evaluation/writeback/config')
  putConfigController(
    @Param('modelId') modelId: string,
    @Body() dto: PutWriteBackConfigDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.config.putConfigService(modelId, dto, user);
  }

  /** `dryRun: true` reports what would happen and writes nothing. */
  @Post('/evaluation/writeback')
  writeController(
    @Param('modelId') modelId: string,
    @Body() dto: WriteBackDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.writer.writeService(modelId, dto, user);
  }

  @Get('/evaluation/writeback/history')
  historyController(
    @Param('modelId') modelId: string,
    @Query() query: WriteBackHistoryQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.writer.listHistoryService(modelId, query, user);
  }

  // After `/history` and `/config` so a literal path never reads as an id.
  @Get('/evaluation/writeback/:batchId')
  batchController(
    @Param('modelId') modelId: string,
    @Param('batchId') batchId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.writer.getBatchService(modelId, batchId, user);
  }

  /** `dryRun: true` reports blockers and drift without changing anything. */
  @Post('/evaluation/writeback/:batchId/rollback')
  rollbackController(
    @Param('modelId') modelId: string,
    @Param('batchId') batchId: string,
    @Body() dto: RollbackDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.rollback.rollbackService(modelId, batchId, dto, user);
  }
}
