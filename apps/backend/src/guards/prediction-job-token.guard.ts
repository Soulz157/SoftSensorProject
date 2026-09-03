import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { FastifyRequest } from 'fastify/types/request';

type PredictionJobTokenRequest = FastifyRequest<{ Params: { jobId?: string } }>;

/**
 * MODEL-SERVE-003. Guards the batch container's own callbacks
 * (`/batch-claim`, `/batch-log`, `/batch-upload-urls`, `/batch-complete`) —
 * deliberately NOT `RunTokenGuard` or `ScoreTokenGuard`, both of which look
 * up `ModelTrainingRun`; a `PredictionJob` is a different entity with no
 * relation to that table.
 *
 * Same shape as `RunTokenGuard`: `status` gates admission, since a batch
 * job (unlike a scoring phase) has no "already terminal" row it must avoid
 * re-flipping — `PredictionJob` is created FOR this job, never reused
 * across attempts the way a training run's status is reused across its own
 * scoring phase.
 */
@Injectable()
export class PredictionJobTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PredictionJobTokenRequest>();

    const jobId = req.params.jobId;
    const header = req.headers.authorization;
    if (!jobId || !header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const hash = createHash('sha256')
      .update(header.slice('Bearer '.length))
      .digest('hex');

    const job = await this.prisma.predictionJob.findUnique({
      where: { id: jobId },
      select: { tokenHash: true, tokenExpiresAt: true, status: true },
    });

    if (!job || job.tokenHash !== hash) throw new UnauthorizedException();
    if (job.tokenExpiresAt < new Date()) throw new UnauthorizedException();
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') {
      throw new UnauthorizedException();
    }
    return true;
  }
}
