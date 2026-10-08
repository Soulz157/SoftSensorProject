import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ModelDraftCleanupAdminService } from './model-draft-cleanup.admin.service';
import { RunModelDraftCleanupDto } from './dto/model-draft-cleanup.admin.dto';

/**
 * MODEL-FLOW-011. ADMIN-only: this endpoint deletes MinIO bytes and can flip
 * a ModelDraft to ABANDONED (never deletes the row itself — see the service
 * doc comment). Thin by design (CLAUDE.md §5) — validation and orchestration
 * live in the service.
 */
@ApiBearerAuth()
@ApiTags('Model Draft Cleanup Admin')
@Controller({ path: 'authorized/model-draft-cleanup/admin', version: '1' })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
export class ModelDraftCleanupAdminController {
  constructor(private readonly service: ModelDraftCleanupAdminService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run ModelDraft reclaim sweep (ADMIN)',
    description:
      'Abandons stale ACTIVE ModelDrafts (no runs past the empty-idle ' +
      'window, or owning runs past the runs-idle window) and reclaims their ' +
      'training-run objects under drafts/{id}/runs/. Never deletes a ' +
      'ModelDraft row, never reclaims a run a Model has adopted by pointer. ' +
      '`dryRun` defaults to true — pass `{"dryRun": false}` to actually ' +
      'abandon drafts and delete objects.',
  })
  async runCleanupController(@Body() body: RunModelDraftCleanupDto) {
    const result = await this.service.run({ dryRun: body.dryRun });
    return {
      statusCode: 200,
      message: result.dryRun
        ? 'ModelDraft cleanup dry run complete'
        : 'ModelDraft cleanup run complete',
      type: 'SUCCESS' as const,
      data: result,
    };
  }
}
