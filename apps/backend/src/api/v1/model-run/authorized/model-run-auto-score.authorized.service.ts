import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { findHoldoutArtifact } from '@/lib/holdout-artifact';
import { mintRunToken } from '@/lib/mint-run-token';
import { TrainningContainerAuthorizedService } from '../../trainning-container/authorized/trainning-container.authorized.service';

/** Same window `ModelRunScoreAuthorizedService` mints for a user-triggered
 *  score — declared here rather than imported from it, because the whole
 *  point of this file is to depend on nothing that depends back. */
const SCORE_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * MODEL-FLOW-019-T39. Score finished candidates against their dataset's
 * holdout, without waiting for anyone to find the Score action.
 *
 * WHY ITS OWN SERVICE, AND NOT A METHOD ON `ModelRunScoreAuthorizedService`
 * WHERE IT STARTED. That was the first shape and it did not boot:
 * `ModelCandidateJobAuthorizedService` has to import whatever owns this,
 * the score service imports `ModelRunAuthorizedService`, and that imports
 * the candidate-job service — a cycle. Nest reported it as
 * "Nest can't resolve dependencies of the ModelRunScoreAuthorizedService
 * (PrismaService, ?, ...)": at module-load time one of the three files
 * necessarily sees an undefined binding. Resolving the score service
 * lazily through `ModuleRef` did NOT fix it, because the cycle is created
 * by the IMPORT STATEMENT, not by when the instance is requested.
 *
 * This file therefore depends on exactly two things — Prisma and the
 * container runner — neither of which depends back, so the candidate-job
 * service injects it in the ordinary way. The user-facing
 * `triggerScoringService` stays where it was; only the system-triggered
 * path lives here.
 *
 * BEST EFFORT, AND NEVER FATAL. Every precondition the user-facing trigger
 * enforces still applies, but here a failure is LOGGED AND SKIPPED rather
 * than thrown: this runs inside job completion, and a model whose holdout
 * cannot be scored (none on the chain, an lstm/gru run with no windowing
 * path, a missing artifact) must still complete its training job. The Score
 * action remains, and still reports those same refusals out loud.
 */
@Injectable()
export class ModelRunAutoScoreAuthorizedService {
  private readonly log = new Logger(ModelRunAutoScoreAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TrainningContainerAuthorizedService,
  ) {}

  /**
   * SEQUENTIAL, not `Promise.all`. One container per run: a 12-candidate
   * sweep would otherwise spawn twelve at once the moment training ends.
   */
  async autoScoreRunsService(runIds: string[]) {
    for (const runId of runIds) {
      try {
        const run = await this.prisma.modelTrainingRun.findUnique({
          where: { id: runId },
          omit: { tokenHash: true },
        });
        if (!run || run.status !== 'SUCCEEDED') continue;
        // Already scored, or a container is already doing it. Both are
        // ordinary on a re-entered completion path, so neither is logged.
        if (run.holdoutMetrics !== null || run.scoringContainerId) continue;
        // Same refusal the user-facing trigger makes, for the same reason —
        // score.py has no windowing path, so it would score a sequence
        // model as if every row were independent.
        if (run.algorithm === 'lstm' || run.algorithm === 'gru') continue;
        if (!run.featureSpecKey || !run.modelKey) continue;

        const holdoutArtifact = await findHoldoutArtifact(
          this.prisma,
          run.goldArtifactId,
        );
        // The common case for a dataset saved without a holdout window.
        // Not an error: there is simply nothing to score against.
        if (!holdoutArtifact) continue;

        const { token, tokenHash } = mintRunToken();
        await this.prisma.modelTrainingRun.update({
          where: { id: runId },
          data: {
            tokenHash,
            tokenExpiresAt: new Date(Date.now() + SCORE_TOKEN_TTL_MS),
          },
        });
        await this.runner.spawn(runId, token, 'score');
        this.log.log(`auto-scoring run ${runId} against its holdout`);
      } catch (err) {
        this.log.warn(
          `auto-score skipped run ${runId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
