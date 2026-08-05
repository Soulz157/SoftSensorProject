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
import { DatasetDraftAuthorizedService } from './dataset-draft.authorized.service';
import { CreateDraftDto } from './dto/dataset-draft.authorized.dto';
import {
  CreateRawVersionDto,
  ListRowsDto,
  PreviewVersionDto,
  StartCleanJobDto,
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
  @ApiOperation({ summary: 'Read a page of rows from a draft artifact' })
  async listDraftArtifactRowsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Query() query: ListRowsDto,
  ) {
    return this.service.listDraftRowsService(user, id, artifactId, query);
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
