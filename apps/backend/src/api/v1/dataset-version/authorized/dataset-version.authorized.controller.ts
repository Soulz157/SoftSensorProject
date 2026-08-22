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
  BoxplotRequestDto,
  CorrelationRequestDto,
  CreateRawVersionDto,
  HistogramRequestDto,
  ListRowsDto,
  PreviewVersionDto,
  PromoteVersionStatusDto,
  ScatterRequestDto,
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

  @Post('/:id/versions/:versionId/promote')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Promote a version through the registry lifecycle',
    description:
      'DS-LAKE-010. Legal path: DRAFT -> VALIDATED -> ACTIVE -> ' +
      'DEPRECATED -> ARCHIVED, one step at a time. Metadata-only — no ' +
      'artifact is copied, regenerated or overwritten.',
  })
  async promoteVersionController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: PromoteVersionStatusDto,
  ) {
    return this.service.promoteVersionService(user, id, versionId, body);
  }

  @Get('/:id/versions/:versionId/lineage')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The frozen BRONZE -> FINAL artifact chain for one version',
    description:
      'DS-LAKE-010-T03. Returns the point-in-time snapshot recorded at ' +
      'Save time, root-first — not a live query, so it stays correct even ' +
      'after intermediate-artifact cleanup reclaims older objects.',
  })
  async getVersionLineageController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.service.getVersionLineageService(user, id, versionId);
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

  @Get('/:id/artifacts/:artifactId/holdout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Raw validation holdout window, if this dataset has one',
    description:
      'Resolves the BRONZE sibling of the given artifact (by runId, same ' +
      'lookup training claim() uses) and returns its holdout window, row ' +
      'count, and missing rate. `data.holdout` is null — not a 404 — when ' +
      'the dataset has no holdout or the artifact predates this field.',
  })
  async getArtifactHoldoutController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    return this.service.getArtifactHoldoutService(user, id, artifactId);
  }

  @Post('/:id/artifacts/:artifactId/correlation')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Pearson correlation matrix over a server-resolved column list, hard-capped',
    description:
      'DS-LAKE-005B-D-T05b, saved-dataset leg. Read-only — creates no ' +
      'object, job or artifact. `tags` is the candidate universe; the ' +
      'server resolves it down to at most `topK` columns and echoes the ' +
      'resolved list back. Unlike the draft leg this artifact is immutable, ' +
      'so `operations` is always sent empty — there is no pending recipe ' +
      'for a committed artifact to be recomputed under.',
  })
  async getArtifactCorrelationController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: CorrelationRequestDto,
  ) {
    return this.service.getArtifactCorrelationService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/histogram')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Per-tag histogram and KDE over a committed artifact',
    description:
      'Saved-dataset leg of the draft endpoint, added so edit mode can read ' +
      'the BRONZE adopted at Save (DS-LAKE-017-T01). The draft leg cannot: ' +
      "that artifact's `draftId` belongs to the draft that originally " +
      'created it, not to the fresh draft an edit session opens, so a ' +
      '`where: { id, draftId }` lookup misses it entirely. Read-only. ' +
      '`operations` is always empty here, same as /correlation above — a ' +
      'committed artifact is immutable and carries its cleaning baked in.',
  })
  async getArtifactHistogramController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: HistogramRequestDto,
  ) {
    return this.service.getArtifactHistogramService(user, id, artifactId, body);
  }

  @Post('/:id/artifacts/:artifactId/boxplot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Per-tag box plot over a committed artifact',
    description:
      'Saved-dataset leg of the draft endpoint, added so edit mode can read ' +
      'the BRONZE adopted at Save (DS-LAKE-017-T01). The draft leg cannot: ' +
      "that artifact's `draftId` belongs to the draft that originally " +
      'created it, not to the fresh draft an edit session opens, so a ' +
      '`where: { id, draftId }` lookup misses it entirely. Read-only. ' +
      '`operations` is always empty here, same as /correlation above — a ' +
      'committed artifact is immutable and carries its cleaning baked in.',
  })
  async getArtifactBoxplotController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: BoxplotRequestDto,
  ) {
    return this.service.getArtifactBoxplotService(user, id, artifactId, body);
  }

  @Post('/:id/artifacts/:artifactId/scatter')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Per-tag scatter plot over a committed artifact',
    description:
      'Saved-dataset leg of the draft endpoint, added so edit mode can read ' +
      'the BRONZE adopted at Save (DS-LAKE-017-T01). The draft leg cannot: ' +
      "that artifact's `draftId` belongs to the draft that originally " +
      'created it, not to the fresh draft an edit session opens, so a ' +
      '`where: { id, draftId }` lookup misses it entirely. Read-only. ' +
      '`operations` is always empty here, same as /correlation above — a ' +
      'committed artifact is immutable and carries its cleaning baked in.',
  })
  async getArtifactScatterController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: ScatterRequestDto,
  ) {
    return this.service.getArtifactScatterService(user, id, artifactId, body);
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

  @Get('/:id/loader-jobs/:jobId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Loader job status (DS-LAKE-011)',
    description:
      'The asynchronous hand-off from a committed DatasetVersion to a ' +
      'serving-layer sink. Metadata only — never dataset rows.',
  })
  async getLoaderJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getLoaderJobStatusService(user, id, jobId);
  }

  @Post('/:id/loader-jobs/:jobId/retry')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Retry a failed or canceled loader job (DS-LAKE-011)',
    description:
      'Creates a NEW loader job rather than resetting the old one, so the ' +
      'failed attempt stays on the record.',
  })
  async retryLoaderJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.retryLoaderJobService(user, id, jobId);
  }
}
