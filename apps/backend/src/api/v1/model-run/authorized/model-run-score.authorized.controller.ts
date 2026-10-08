import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ScoreTokenGuard } from '@/guards/score-token.guard';
import { ModelRunScoreAuthorizedService } from './model-run-score.authorized.service';
import {
  RunLogDto,
  RunUploadUrlsDto,
  ScoreCompleteDto,
} from './dto/model-run.authorized.dto';

/**
 * Callbacks from a SCORING container — the twin of
 * `ModelRunAuthorizedController` for MODEL-FLOW-016-T07's separate holdout-
 * scoring phase. Deliberately its own controller with its own guard: see
 * `ScoreTokenGuard`'s doc comment for why `RunTokenGuard` cannot be reused
 * here (its own terminal-status check refuses every call once a run is
 * SUCCEEDED, which a CV run already is by the time scoring starts).
 */
@Controller('authorized/model/runs')
@UseGuards(ScoreTokenGuard)
export class ModelRunScoreAuthorizedController {
  constructor(private readonly service: ModelRunScoreAuthorizedService) {}

  @Post('/:runId/score-claim')
  scoreClaim(@Param('runId') runId: string) {
    return this.service.scoreClaimService(runId);
  }

  @Post('/:runId/score-log')
  scoreLog(@Param('runId') runId: string, @Body() dto: RunLogDto) {
    return this.service.scoreLogService(runId, dto);
  }

  @Post('/:runId/score-upload-urls')
  scoreUploadUrls(
    @Param('runId') runId: string,
    @Body() dto: RunUploadUrlsDto,
  ) {
    return this.service.scoreUploadUrlsService(runId, dto.filenames);
  }

  @Post('/:runId/score-complete')
  scoreComplete(@Param('runId') runId: string, @Body() dto: ScoreCompleteDto) {
    return this.service.scoreCompleteService(runId, dto);
  }
}
