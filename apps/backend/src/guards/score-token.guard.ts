import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { FastifyRequest } from 'fastify/types/request';

type ScoreTokenRequest = FastifyRequest<{ Params: { runId?: string } }>;

/**
 * MODEL-FLOW-016-T07. Guards the scoring container's own callbacks
 * (`/score-claim`, `/score-complete`) — deliberately NOT `RunTokenGuard`,
 * whose own terminal check (`status !== 'QUEUED' && status !== 'RUNNING'`)
 * refuses every call once a run is SUCCEEDED, which a CV run already is by
 * the time scoring starts. Reusing `RunTokenGuard` here (or reusing its
 * token column with no route separation) would need `status` flipped back
 * toward RUNNING to admit the scoring container — which would ALSO
 * re-admit the container's callback token onto the training routes
 * (`/claim`, `/complete`, `/log`, `/upload-urls`), letting a scoring
 * container that mistakenly (or maliciously) posts to the training
 * `/complete` re-flip a terminal run's status, metrics, and owning draft.
 *
 * This guard checks `scoringContainerId` instead: non-null means a scoring
 * phase is actively in flight (set by the trigger's spawn, cleared by
 * `/score-complete` or by `TrainningContainerAuthorizedService.watch`'s own
 * exited-without-reporting branch — see that column's doc comment on
 * `ModelTrainingRun`). `status` is never read or written by this guard, so
 * a CV run staying SUCCEEDED throughout scoring is exactly the point, not
 * a workaround.
 *
 * `tokenHash`/`tokenExpiresAt` are the SAME single-valued columns the
 * training token used — overwritten at scoring-trigger time (the training
 * token is already dead by then; see `mintRunToken`'s caller). Sharing the
 * column is safe specifically BECAUSE `RunTokenGuard`'s own status check
 * structurally refuses the new token on every training route.
 */
@Injectable()
export class ScoreTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ScoreTokenRequest>();

    const runId = req.params.runId;
    const header = req.headers.authorization;
    if (!runId || !header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const hash = createHash('sha256')
      .update(header.slice('Bearer '.length))
      .digest('hex');

    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
      select: {
        tokenHash: true,
        tokenExpiresAt: true,
        scoringContainerId: true,
      },
    });

    if (!run || run.tokenHash !== hash) throw new UnauthorizedException();
    if (run.tokenExpiresAt < new Date()) throw new UnauthorizedException();
    // No scoring phase in flight for this run — either never triggered, or
    // already finished (scored or failed). A late straggler must not be
    // able to overwrite a recorded outcome, same discipline RunTokenGuard
    // applies via `status` for training.
    if (!run.scoringContainerId) throw new UnauthorizedException();
    return true;
  }
}
