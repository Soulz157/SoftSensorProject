import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { FastifyRequest } from 'fastify/types/request';

type RunTokenRequest = FastifyRequest<{ Params: { runId?: string } }>;

@Injectable()
export class RunTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RunTokenRequest>();

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
      select: { tokenHash: true, tokenExpiresAt: true, status: true },
    });

    // The token must match THIS run. A valid token for another run is not a
    // valid token here — otherwise one container could write another's
    // results.
    if (!run || run.tokenHash !== hash) throw new UnauthorizedException();
    if (run.tokenExpiresAt < new Date()) throw new UnauthorizedException();
    // A finished run accepts no further callbacks: a late straggler must not
    // be able to overwrite a recorded outcome.
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      throw new UnauthorizedException();
    }
    return true;
  }
}
