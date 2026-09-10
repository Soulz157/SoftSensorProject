import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { InferenceWindowTokenGuard } from '@/guards/inference-window-token.guard';
import { InferenceWindowAuthorizedService } from './inference-window.authorized.service';
import {
  InferenceWindowCompleteDto,
  InferenceWindowLogDto,
  InferenceWindowUploadUrlsDto,
} from './dto/inference-window.authorized.dto';

/**
 * MODEL-SERVE-006. The infer-mode container's own callbacks — separate
 * guard, separate controller from `InferenceWindowAuthorizedController`,
 * mirroring `PredictionJobCallbackAuthorizedController`'s split from
 * `PredictionJobAuthorizedController` (see `InferenceWindowTokenGuard`'s
 * own doc comment for why reusing another entity's token guard here would
 * be wrong).
 *
 * Route shape matches `RunContext.api` on the trainer side:
 * `authorized/inference-windows/:windowId/infer-*`.
 */
@Controller('authorized/inference-windows')
@UseGuards(InferenceWindowTokenGuard)
export class InferenceWindowCallbackAuthorizedController {
  constructor(private readonly service: InferenceWindowAuthorizedService) {}

  @Post('/:windowId/infer-claim')
  claimController(@Param('windowId') windowId: string) {
    return this.service.claimService(windowId);
  }

  @Post('/:windowId/infer-log')
  async logController(
    @Param('windowId') windowId: string,
    @Body() dto: InferenceWindowLogDto,
  ) {
    await this.service.logService(windowId, dto);
    return { statusCode: 200, message: 'Logged', type: 'SUCCESS' as const };
  }

  @Post('/:windowId/infer-upload-urls')
  uploadUrlsController(
    @Param('windowId') windowId: string,
    @Body() dto: InferenceWindowUploadUrlsDto,
  ) {
    return this.service.uploadUrlsService(windowId, dto);
  }

  @Post('/:windowId/infer-complete')
  completeController(
    @Param('windowId') windowId: string,
    @Body() dto: InferenceWindowCompleteDto,
  ) {
    return this.service.completeService(windowId, dto);
  }
}
