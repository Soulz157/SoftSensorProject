import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt/dist/jwt.service';
import { AppException } from '@softsensor/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import { randomBytes } from 'crypto';
import { REFRESH_TOKEN_TTL_MS } from '@/config/cookie.config';

interface LogoutMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async getMeService(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        role: true,
      },
    });

    if (!user) {
      throw new AppException({
        statusCode: 404,
        message: 'User not found',
        type: 'ERROR',
      });
    }

    return {
      statusCode: 200,
      message: 'ดึงข้อมูลผู้ใช้สำเร็จ',
      type: 'SUCCESS',
      data: user,
    };
  }

  async logoutService(userId: string, meta?: LogoutMeta) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.authLog.create({
        data: {
          userId,
          action: PrismaEnums.AuthAction.LOGOUT,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      }),
    ]);

    return {
      statusCode: 200,
      message: 'ออกจากระบบสำเร็จ',
      type: 'SUCCESS',
    };
  }

  async refreshService(
    token: string,
  ): Promise<{ response: object; refreshToken: string }> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date() || record.revokedAt) {
      throw new AppException({
        statusCode: 401,
        message: 'Refresh token invalid or expired',
        type: 'ERROR',
      });
    }

    const { user } = record;
    const accessToken = this.jwtService.sign<Auth.UserPayload>(
      {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        company: user.company ?? '',
        role: user.role,
      },
      { expiresIn: '15m' },
    );

    const newRefreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { token } }),
      this.prisma.refreshToken.create({
        data: { token: newRefreshToken, userId: user.id, expiresAt },
      }),
    ]);

    return {
      response: {
        statusCode: 200,
        message: 'Token refreshed successfully',
        type: 'SUCCESS',
        data: { accessToken },
      },
      refreshToken: newRefreshToken,
    };
  }
}
