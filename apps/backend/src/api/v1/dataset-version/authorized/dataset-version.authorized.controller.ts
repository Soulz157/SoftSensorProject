import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { DatasetVersionAuthorizedService } from './dataset-version.authorized.service';
import {
  CreateRawVersionDto,
  ListRowsDto,
  PreviewVersionDto,
  StartCleanJobDto,
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
  @ApiOperation({ summary: 'Read a page of rows from a committed artifact' })
  async listArtifactRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: ListRowsDto,
  ) {
    return this.service.listRowsService(user, id, artifactId, query);
  }

  @Get('/:id/versions/:versionId/rows')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Read a page of rows from a committed version',
    description:
      'Compatibility shim. Resolves a DatasetVersion id OR a DatasetArtifact ' +
      'id, so datasets created before DS-LAKE-004 keep working and the model ' +
      'wizard needs no changes.',
  })
  async listRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Query() query: ListRowsDto,
  ) {
    return this.service.listRowsService(user, id, versionId, query);
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
