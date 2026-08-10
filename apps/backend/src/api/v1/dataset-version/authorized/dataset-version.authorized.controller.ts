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
import { DatasetVersionAuthorizedService } from './dataset-version.authorized.service';
import {
  CreateRawVersionDto,
  ListRowsDto,
  PreviewVersionDto,
  StartCleanJobDto,
  TagCatalogDto,
} from './dto/dataset-version.authorized.dto';

/**
 * Dataset versions and preprocessing jobs.
 *
 * A separate controller from `DatasetAuthorizedController` rather than more
 * routes on it: these paths use owner-or-member workspace access, while the
 * CRUD routes filter by creator. Keeping them apart makes that difference
 * visible instead of hiding two access rules behind one class. It now also
 * lives in its own module (DatasetVersionModule) — the two halves share no
 * code, only this prefix. Both keep the `authorized/dataset` prefix, so the
 * split changed no URL; the segments below are all new.
 *
 * Thin by design (CLAUDE.md §5) — every method delegates.
 */
@ApiBearerAuth()
@ApiTags('Dataset Version')
@Controller('authorized/dataset')
@UseGuards(JwtAccessGuard)
export class DatasetVersionAuthorizedController {
  constructor(private readonly service: DatasetVersionAuthorizedService) {}

  @Get('/:id/versions')
  @HttpCode(200)
  @ApiOperation({ summary: 'List the version lineage of a dataset' })
  async listVersionsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.listVersionsService(user, id);
  }

  @Post('/:id/versions')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Materialize the raw (V1) version from a saved data source',
    description:
      'Fetches from the source and writes the first artifact. Runs inline — a ' +
      'fetch has no intermediate steps to report, so it needs no job row.',
  })
  async createRawVersionController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: CreateRawVersionDto,
  ) {
    return this.service.createRawVersionService(user, id, body);
  }

  @Post('/:id/artifacts')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Materialize the BRONZE artifact from a saved data source',
    description:
      'Canonical route since DS-LAKE-004. Fetches from the source and writes ' +
      'the bronze artifact. Creates NO DatasetVersion — a version is created ' +
      'only by Save Dataset. Runs inline: a fetch has no intermediate steps ' +
      'to report, so it needs no job row.',
  })
  async createBronzeArtifactController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: CreateRawVersionDto,
  ) {
    return this.service.createRawVersionService(user, id, body);
  }

  @Get('/:id/artifacts/:artifactId/rows')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a page of rows from a committed artifact',
    description:
      '`format=arrow` (DS-LAKE-005B-A-T05, rescoped to server-side transport ' +
      'only) returns the page as an Arrow IPC stream instead of JSON, with ' +
      'the envelope in X-Total-Row-Count/X-Offset/X-Filtered/X-Start-Time/' +
      'X-End-Time response headers. No current client reads this format.',
  })
  async listArtifactRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: ListRowsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const result = await this.service.listRowsService(
      user,
      id,
      artifactId,
      query,
    );
    return this.sendRowsResult(reply, result);
  }

  @Get('/:id/versions/:versionId/rows')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a page of rows from a committed version',
    description:
      'Compatibility shim. Resolves a DatasetVersion id OR a DatasetArtifact ' +
      'id, so datasets created before DS-LAKE-004 keep working and the model ' +
      'wizard needs no changes. Supports `format=arrow` identically to the ' +
      'canonical artifact route above.',
  })
  async listRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query() query: ListRowsDto,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const result = await this.service.listRowsService(
      user,
      id,
      versionId,
      query,
    );
    return this.sendRowsResult(reply, result);
  }

  /**
   * Shared by both rows routes above (canonical + legacy compat shim), so
   * the arrow-vs-json branch cannot drift between them. `@Res({passthrough:
   * false})` hands over full control of the reply — needed for the arrow
   * branch's raw bytes/headers — so the json branch must also send
   * manually here rather than relying on Nest's automatic serialization.
   */
  private sendRowsResult(
    reply: FastifyReply,
    result: Awaited<
      ReturnType<DatasetVersionAuthorizedService['listRowsService']>
    >,
  ) {
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
  async getArtifactMetadataController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getArtifactMetadataService(user, id, artifactId);
  }

  @Get('/:id/artifacts/:artifactId/tags')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Paginated, searchable tag catalog',
    description:
      'Same footer-only read as /metadata (DS-LAKE-005B-A-T03) — never a ' +
      'row payload, so 8,000+ tags can be browsed one page at a time.',
  })
  async getArtifactTagCatalogController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: TagCatalogDto,
  ) {
    return this.service.getArtifactTagCatalogService(
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
  async getArtifactColumnStatsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getArtifactColumnStatsService(user, id, artifactId);
  }

  @Post('/:id/versions/:versionId/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview a cleaning pipeline without applying it',
    description:
      'Creates no object, no version row and no job. Computed on a capped ' +
      'sample, so the response flags when its numbers are indicative.',
  })
  async previewController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: PreviewVersionDto,
  ) {
    return this.service.previewService(user, id, versionId, body);
  }

  @Post('/:id/versions/:versionId/clean')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start a cleaning job (202 + jobId)',
    description:
      'Returns immediately with a job id; poll `GET /:id/jobs/:jobId` for ' +
      'progress. The request never waits on the pipeline.',
  })
  async startCleanJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: StartCleanJobDto,
  ) {
    return this.service.startCleanJobService(user, id, versionId, body);
  }

  @Get('/:id/jobs/:jobId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Job status, progress and current step' })
  async getJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getJobService(user, id, jobId);
  }

  @Post('/:id/jobs/:jobId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a queued or running job' })
  async cancelJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.cancelJobService(user, id, jobId);
  }

  @Post('/:id/jobs/:jobId/retry')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Retry a failed or canceled job',
    description:
      'Creates a NEW job rather than resetting the old one, so the failed ' +
      'attempt stays on the record and the retry writes a fresh version key.',
  })
  async retryJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.retryJobService(user, id, jobId);
  }
}
