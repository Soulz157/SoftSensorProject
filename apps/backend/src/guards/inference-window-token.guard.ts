import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { FastifyRequest } from 'fastify/types/request';

type InferenceWindowTokenRequest = FastifyRequest<{
  Params: { windowId?: string };
}>;

/**
 * MODEL-SERVE-006. Guards the infer-mode container's own callbacks
 * (`/infer-claim`, `/infer-log`, `/infer-upload-urls`, `/infer-complete`) —
 * a fourth token guard, deliberately NOT a reuse of `RunTokenGuard`,
 * `ScoreTokenGuard`, or `PredictionJobTokenGuard`: each of those looks up a
 * different table (`ModelTrainingRun` twice, `PredictionJob` once), and an
 * `InferenceWindow` is a fifth, independent entity with no relation to any
 * of them. Reusing one would mean bending another entity's status field to
 * admit a caller it was never written for — the same reasoning
 * `ScoreTokenGuard`'s own doc comment gives for why it exists separately
 * from `RunTokenGuard`.
 *
 * Same shape as `PredictionJobTokenGuard`: `status` gates admission, and an
 * `InferenceWindow` is created FOR this run, never reused across attempts —
 * a retry (D9, `POST /inference/windows/:windowId/retry`) flips the row
 * back to PENDING and mints a FRESH token, it does not resurrect the old
 * one.
 */
@Injectable()
export class InferenceWindowTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<InferenceWindowTokenRequest>();

    const windowId = req.params.windowId;
    const header = req.headers.authorization;
    if (!windowId || !header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const hash = createHash('sha256')
      .update(header.slice('Bearer '.length))
      .digest('hex');

    const window = await this.prisma.inferenceWindow.findUnique({
      where: { id: windowId },
      select: { tokenHash: true, tokenExpiresAt: true, status: true },
    });

    if (!window || window.tokenHash !== hash) throw new UnauthorizedException();
    if (window.tokenExpiresAt < new Date()) throw new UnauthorizedException();
    if (window.status !== 'PENDING' && window.status !== 'RUNNING') {
      throw new UnauthorizedException();
    }
    return true;
  }
}
