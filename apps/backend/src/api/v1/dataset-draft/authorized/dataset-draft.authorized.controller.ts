import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { DatasetDraftAuthorizedService } from './dataset-draft.authorized.service';
import { CreateDraftDto } from './dto/dataset-draft.authorized.dto';
import {
  CreateRawVersionDto,
  ListRowsDto,
  PreviewVersionDto,
  StartCleanJobDto,
  TagCatalogDto,
} from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';

/**
 * `DatasetDraft` — the Dataset Creation wizard's server-side owner while no
 * `Dataset` row exists yet (Draft-first architecture, DS-LAKE-005).
 *
 * Deliberately its own top-level route (`authorized/dataset-drafts`), not
 * nested under `authorized/dataset` like the version routes next door: a
 * draft is not a dataset and has no dataset id to key a nested route on.
 *
 * Thin by design (CLAUDE.md §5) — every method delegates.
 */
@ApiBearerAuth()
@ApiTags('Dataset Draft')
@Controller('authorized/dataset-drafts')
@UseGuards(JwtAccessGuard)
export class DatasetDraftAuthorizedController {
  constructor(private readonly service: DatasetDraftAuthorizedService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a Dataset Creation draft',
    description:
      'Creates NO Dataset row. The wizard runs Bronze/Silver jobs against ' +
      'this draft until Save Dataset promotes it.',
  })
  async createDraftController(
    @Users() user: Auth.UserPayload,
    @Body() body: CreateDraftDto,
  ) {
    return this.service.createDraftService(user, body);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch a Dataset Creation draft' })
  async getDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.getDraftService(user, id);
  }

  @Post('/:id/abandon')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Abandon a draft',
    description:
      'Marks the draft ABANDONED. Its artifacts and jobs are left in place — ' +
      'nothing is deleted.',
  })
  async abandonDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.abandonDraftService(user, id);
  }

  @Post('/:id/artifacts')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Materialize the draft BRONZE artifact from a saved data source',
    description:
      'Fetches from the source and writes the bronze artifact under ' +
      'drafts/{draftId}. Creates NO Dataset and NO DatasetVersion.',
  })
  async createDraftArtifactController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: CreateRawVersionDto,
  ) {
    return this.service.materializeDraftArtifactService(user, id, body);
  }

  @Get('/:id/artifacts/:artifactId/rows')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a page of rows from a draft artifact',
    description:
      '`format=arrow` (DS-LAKE-005B-A-T05, rescoped to server-side transport ' +
      'only) returns the page as an Arrow IPC stream instead of JSON, with ' +
      'the envelope in X-Total-Row-Count/X-Offset/X-Filtered/X-Start-Time/' +
      'X-End-Time response headers. No current client reads this format.',
  })
  async listDraftArtifactRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: ListRowsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const result = await this.service.listDraftRowsService(
      user,
      id,
      artifactId,
      query,
    );
    if (result.format === 'arrow') {
      reply.headers(result.headers);
      reply.type(result.contentType);
      reply.status(200);
      reply.send(result.buffer);
      return;
    }
    reply.status(result.statusCode).send(result);
  }

  @Get('/:id/artifacts/:artifactId/metadata')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Artifact metadata: schema, time range, quality summary',
    description:
      'Bounded viewport metadata, never a row payload (DS-LAKE-005B-A-T01). ' +
      'rowCount/tagCount/missingPct/checksum come from the DatasetArtifact ' +
      'row with zero I/O; tags and the time range are read from the object.',
  })
  async getDraftArtifactMetadataController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getDraftArtifactMetadataService(user, id, artifactId);
  }

  @Get('/:id/artifacts/:artifactId/tags')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Paginated, searchable tag catalog',
    description:
      'Same footer-only read as /metadata (DS-LAKE-005B-A-T03) — never a ' +
      'row payload, so 8,000+ tags can be browsed one page at a time.',
  })
  async getDraftArtifactTagCatalogController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: TagCatalogDto,
  ) {
    return this.service.getDraftArtifactTagCatalogService(
      user,
      id,
      artifactId,
      query,
    );
  }

  @Get('/:id/artifacts/:artifactId/column-stats')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Per-tag aggregate stats sidecar (coverage, outliers, drift)',
    description:
      'Reads ONLY the column_stats.json sidecar written at write time ' +
      '(DS-LAKE-005B-A-T07) — data.parquet is never opened, so this costs ' +
      'the same one object download for 8,000 tags as for one. 404 if the ' +
      'artifact predates this task and has no sidecar.',
  })
  async getDraftArtifactColumnStatsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getDraftArtifactColumnStatsService(
      user,
      id,
      artifactId,
    );
  }

  @Post('/:id/artifacts/:artifactId/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview a cleaning pipeline against a draft artifact',
    description:
      'Creates NO object, job or artifact. T01 hybrid: called only when the ' +
      'client-side scrubber settles on the final step, debounced — not on ' +
      'every intermediate edit.',
  })
  async previewDraftController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: PreviewVersionDto,
  ) {
    return this.service.previewDraftService(user, id, artifactId, body);
  }

  @Post('/:id/artifacts/:artifactId/clean')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start a draft-scoped cleaning job (202 + jobId)',
    description:
      'Returns immediately with a job id; poll `GET /:id/jobs/:jobId` for ' +
      'progress. The result lands as a SILVER artifact under this draft.',
  })
  async startDraftCleanJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: StartCleanJobDto,
  ) {
    return this.service.startDraftCleanJobService(user, id, artifactId, body);
  }

  @Get('/:id/jobs/:jobId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Draft job status, progress and current step' })
  async getDraftJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getDraftJobService(user, id, jobId);
  }

  @Post('/:id/jobs/:jobId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a queued or running draft job' })
  async cancelDraftJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.cancelDraftJobService(user, id, jobId);
  }

  @Post('/:id/jobs/:jobId/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry a failed or canceled draft job' })
  async retryDraftJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.retryDraftJobService(user, id, jobId);
  }
}
