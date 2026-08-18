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
import {
  CreateDraftDto,
  SaveDraftAsDatasetDto,
} from './dto/dataset-draft.authorized.dto';
import {
  BoxplotRequestDto,
  CorrelationRequestDto,
  CreateFeaturesDto,
  CreateRawVersionDto,
  HistogramRequestDto,
  ListRowsDto,
  PreviewVersionDto,
  PromoteFinalArtifactDto,
  ScatterRequestDto,
  StartCleanJobDto,
  TagCatalogDto,
  ValidateArtifactDto,
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

  @Post('/:id/artifacts/:artifactId/features')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Run feature engineering server-side, producing a GOLD artifact',
    description:
      'applyFeatures -> selectColumns -> toModelReady against the named ' +
      'source artifact (normally SILVER). Inline, not job-queued — one ' +
      'combined operation, not a chained per-tag pipeline like /clean. ' +
      'Sets parentArtifactId to the source artifact and persists ' +
      'featureSpecKey from the feature_spec.json sidecar.',
  })
  async createDraftFeaturesArtifactController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: CreateFeaturesDto,
  ) {
    return this.service.createDraftFeaturesArtifactService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/features/job')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start a draft-scoped feature-engineering job (202 + jobId)',
    description:
      'Async replacement for POST .../features (kept running during the ' +
      'transition — see its own description). Returns immediately with a ' +
      'job id; poll `GET /:id/jobs/:jobId` for progress. The result lands ' +
      'as a GOLD artifact under this draft.',
  })
  async startDraftFeaturesJobController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: CreateFeaturesDto,
  ) {
    return this.service.startDraftFeaturesJobService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the validation gate against a draft artifact',
    description:
      'Read-only against the artifact and creates no DatasetArtifact row ' +
      '— returns PASS/FAIL, a quality score, and a per-check breakdown. ' +
      "Uses the artifact's own featureSpecKey (if it has one) automatically.",
  })
  async validateDraftArtifactController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: ValidateArtifactDto,
  ) {
    return this.service.validateDraftArtifactService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/finalize')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Promote a draft artifact into a FINAL artifact',
    description:
      'Re-validates the artifact server-side and REFUSES (422) unless it ' +
      'PASSes — never trusts a client-supplied validation result. Never ' +
      'copies bytes: the FINAL row shares its source objectKey/checksum ' +
      'verbatim. Creates NO Dataset or DatasetVersion — Save Dataset ' +
      '(DS-LAKE-009-T02) is the only place those are created.',
  })
  async promoteDraftArtifactToFinalController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: PromoteFinalArtifactDto,
  ) {
    return this.service.promoteDraftArtifactToFinalService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/save')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Save the draft as a persistent Dataset',
    description:
      'The ONLY operation that creates a DatasetVersion (DS-LAKE-009-T02). ' +
      "Adopts the draft's FINAL artifact by pointer — never copies bytes, " +
      'never re-fetches raw, never replays the recipe. Re-validates the ' +
      'artifact for a fresh Save-time quality score and REFUSES (422) if ' +
      'no FINAL artifact exists or it no longer PASSes.',
  })
  async saveDraftAsDatasetController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: SaveDraftAsDatasetDto,
  ) {
    return this.service.saveDraftAsDatasetService(user, id, body);
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

  @Post('/:id/artifacts/:artifactId/histogram')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Histogram/KDE for one or more tags, recomputed under live operations',
    description:
      'DS-LAKE-005B-D-T01. Creates NO object, job or artifact — read-only, ' +
      'same guarantee /preview makes. Reflects the crop/conditional/' +
      'statistical rules currently live in Step 3.1, not a committed-' +
      'artifact snapshot.',
  })
  async getDraftArtifactHistogramController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: HistogramRequestDto,
  ) {
    return this.service.getDraftArtifactHistogramService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/boxplot')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Five-number summary + capped outlier list per tag, recomputed under live operations',
    description:
      'DS-LAKE-005B-D-T03. Creates NO object, job or artifact — read-only, ' +
      'same guarantee /preview and /histogram make.',
  })
  async getDraftArtifactBoxplotController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: BoxplotRequestDto,
  ) {
    return this.service.getDraftArtifactBoxplotService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/scatter')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decimated scatter cloud + full-frame regression for two tags',
    description:
      'DS-LAKE-005B-D-T04. Creates NO object, job or artifact — read-only, ' +
      'same guarantee /preview, /histogram and /boxplot make. Regression ' +
      'coefficients are always fit over the full Good-filtered frame, ' +
      'never the decimated point sample.',
  })
  async getDraftArtifactScatterController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: ScatterRequestDto,
  ) {
    return this.service.getDraftArtifactScatterService(
      user,
      id,
      artifactId,
      body,
    );
  }

  @Post('/:id/artifacts/:artifactId/correlation')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Pearson correlation matrix over a server-resolved column list, hard-capped',
    description:
      'DS-LAKE-005B-D-T05b. Creates NO object, job or artifact — read-only, ' +
      'same guarantee /preview, /histogram, /boxplot and /scatter make. ' +
      '`tags` is the candidate universe; the server resolves it down to ' +
      'at most `topK` columns and echoes the resolved list back.',
  })
  async getDraftArtifactCorrelationController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: CorrelationRequestDto,
  ) {
    return this.service.getDraftArtifactCorrelationService(
      user,
      id,
      artifactId,
      body,
    );
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
