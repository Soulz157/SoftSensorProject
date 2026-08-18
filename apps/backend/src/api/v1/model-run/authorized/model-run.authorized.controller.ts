import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RunTokenGuard } from '@/guards/run-token.guard';
import { ModelRunAuthorizedService } from './model-run.authorized.service';
import {
  RunCompleteDto,
  RunLogDto,
  RunUploadUrlsDto,
} from './dto/model-run.authorized.dto';

/**
 * Callbacks from a training container. Deliberately a separate controller
 * with a separate guard: the container has no user identity, and giving it a
 * user JWT would hand a sandboxed process the caller's full authority. A run
 * token authorises exactly one run's own callbacks and expires with it.
 */
@Controller('authorized/model/runs')
@UseGuards(RunTokenGuard)
export class ModelRunAuthorizedController {
  constructor(private readonly service: ModelRunAuthorizedService) {}

  @Post('/:runId/claim')
  claim(@Param('runId') runId: string) {
    return this.service.claim(runId);
  }

  @Post('/:runId/log')
  log(@Param('runId') runId: string, @Body() dto: RunLogDto) {
    return this.service.appendLog(runId, dto);
  }

  /** Write URLs. Called once, when the fit is done. */
  @Post('/:runId/upload-urls')
  uploadUrls(@Param('runId') runId: string, @Body() dto: RunUploadUrlsDto) {
    return this.service.mintUploadUrls(runId, dto.filenames);
  }

  @Post('/:runId/complete')
  complete(@Param('runId') runId: string, @Body() dto: RunCompleteDto) {
    return this.service.complete(runId, dto);
  }
}
