import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { JwtPayload } from '@/utils/jwt';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: FastifyRequest) =>
          (req as FastifyRequest & { cookies: Record<string, string> })
            .cookies?.['refreshToken'] ?? null,
      ]),
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET') ?? '',
      passReqToCallback: false,
    });
  }

  async validate(payload: JwtPayload) {
    return { userId: payload.userId, role: payload.role };
  }
}
