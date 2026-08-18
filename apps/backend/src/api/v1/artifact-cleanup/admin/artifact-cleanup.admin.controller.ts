import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ArtifactCleanupAdminService } from './artifact-cleanup.admin.service';
import { RunArtifactCleanupDto } from './dto/artifact-cleanup.admin.dto';

/**
 * DS-LAKE-009B. ADMIN-only: this endpoint deletes MinIO bytes (never a
 * DatasetArtifact row — see the service doc comment). Thin by design
 * (CLAUDE.md §5) — validation and orchestration live in the service.
 */
@ApiBearerAuth()
@ApiTags('Artifact Cleanup Admin')
@Controller({ path: 'authorized/artifact-cleanup/admin', version: '1' })
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
export class ArtifactCleanupAdminController {
  constructor(private readonly service: ArtifactCleanupAdminService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run intermediate-artifact cleanup (ADMIN)',
    description:
      'Reclaims MinIO objects for BRONZE/SILVER/GOLD artifacts that are no ' +
      'longer lineage-pinned and have cleared their retention window. Never ' +
      'deletes a DatasetArtifact row or a FINAL artifact. `dryRun` defaults ' +
      'to true — pass `{"dryRun": false}` to actually delete objects.',
  })
  async runCleanupController(@Body() body: RunArtifactCleanupDto) {
    const result = await this.service.run({ dryRun: body.dryRun });
    return {
      statusCode: 200,
      message: result.dryRun
        ? 'Cleanup dry run complete'
        : 'Cleanup run complete',
      type: 'SUCCESS' as const,
      data: result,
    };
  }
}
