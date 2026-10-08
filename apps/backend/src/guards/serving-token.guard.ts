import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { FastifyRequest } from 'fastify/types/request';
import { env } from '@/config/env.config';

/**
 * MODEL-SERVE-002. Guards the descriptor endpoints `apps/serving` calls to
 * resolve a PRODUCTION ModelVersion and its model bytes — deliberately NOT
 * `JwtAccessGuard`: `JwtAccessStrategy.validate()` carries an unconditional
 * 100ms delay (strategies/jwt-access.strategy.ts:22) with no business being
 * on a path whose whole point is being bounded, and a serving process is
 * not a logged-in user with a workspace to check `assertModelAccess`
 * against — see `serving_host_undecided`'s resolution in
 * docs/feature_list_model.json for why serving is a separate process at
 * all.
 *
 * A single shared secret (`SERVING_API_TOKEN`), not a per-run scoped token
 * like `RunTokenGuard`/`ScoreTokenGuard` — those guard one container
 * reading its OWN run's data; this guards one long-lived process reading
 * across every model's PRODUCTION version, so there is no single row to
 * scope a token to. Compared with `timingSafeEqual`, same discipline a
 * shared-secret comparison needs generally — a naive `===` leaks the
 * token's prefix length through response-time variance.
 */
@Injectable()
export class ServingTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const expected = env.SERVING_API_TOKEN;

    // Fail closed: an unconfigured token must refuse every request, never
    // silently accept because there was nothing to compare against.
    if (!expected || !header?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const presented = header.slice('Bearer '.length);
    const expectedBuf = Buffer.from(expected);
    const presentedBuf = Buffer.from(presented);
    // timingSafeEqual throws on length mismatch rather than returning
    // false — compare lengths first so a short/long guess never reaches it.
    if (
      presentedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(presentedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
