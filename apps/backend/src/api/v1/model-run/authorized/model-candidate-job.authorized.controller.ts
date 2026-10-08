import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import {
  CreateCandidateJobDto,
  SelectCandidateDto,
} from './dto/model-candidate-job.authorized.dto';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';

/**
 * MODEL-FLOW-005, generalized by MODEL-FLOW-013. Draft-scoped, same
 * `authorized/model-drafts` prefix `ModelDraftRunAuthorizedController` uses
 * for single runs — a candidate job has no model id to key a nested route
 * on until Save Model adopts its winning run, exactly the reasoning that
 * controller's own doc comment already gives for itself.
 *
 * Route renamed `/fine-tuning` -> `/candidate-jobs`: nothing client-side
 * called the old path (MODEL-FLOW-013-T03's own audit confirmed zero hits),
 * so the rename carries no compatibility burden.
 */
@ApiBearerAuth()
@ApiTags('Model Candidate Jobs')
@Controller('authorized/model-drafts')
@UseGuards(JwtAccessGuard)
export class ModelCandidateJobAuthorizedController {
  constructor(
    private readonly candidateJobs: ModelCandidateJobAuthorizedService,
  ) {}

  @Post('/:draftId/candidate-jobs')
  @ApiOperation({
    summary:
      'Start a candidate job (hyperparameter search or algorithm sweep) and launch its first run',
    description:
      'A HYPERPARAMETER_SEARCH job holds one algorithm/artifact/split, N ' +
      'hyperparameter sets tried in sequence; an ALGORITHM_SWEEP job varies ' +
      'the algorithm per candidate. Best kept by RMSE either way. Returns ' +
      'immediately with the job id; the job continues in the background as ' +
      'each candidate run completes. Refuses (409) a draft that already has ' +
      'a job in progress.',
  })
  createJobController(
    @Param('draftId') draftId: string,
    @Body() dto: CreateCandidateJobDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.candidateJobs.createJob(draftId, dto, user.id, user.role);
  }

  @Get('/:draftId/candidate-jobs/:jobId')
  @ApiOperation({
    summary:
      "One candidate job — status, progress, every candidate's own outcome, and the best run so far",
    description:
      'Reconciles before returning: if the job’s current run finished ' +
      'but the job itself was not advanced yet, this read advances it ' +
      'first. Every candidate is resolved against its own run row.',
  })
  getJobController(
    @Param('draftId') draftId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.candidateJobs.getJobService(draftId, jobId, user.id, user.role);
  }

  @Post('/:draftId/candidate-jobs/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a FAILED job’s last candidate',
    description:
      'Only a FAILED job can be retried. Relaunches the exact candidate ' +
      'that failed and resumes the job from there.',
  })
  retryJobController(
    @Param('draftId') draftId: string,
    @Param('jobId') jobId: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.candidateJobs.retryJobService(
      draftId,
      jobId,
      user.id,
      user.role,
    );
  }

  @Post('/:draftId/candidate-jobs/:jobId/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Override the metric's winner with the user's chosen candidate",
    description:
      'Only on a terminal job, and only to one of its own SUCCEEDED runs. ' +
      'Writes ModelCandidateJob.selectedRunId only — never ' +
      'ModelDraft.currentRunId, which keeps its single existing writer.',
  })
  selectCandidateController(
    @Param('draftId') draftId: string,
    @Param('jobId') jobId: string,
    @Body() dto: SelectCandidateDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.candidateJobs.selectCandidateService(
      draftId,
      jobId,
      dto,
      user.id,
      user.role,
    );
  }
}
