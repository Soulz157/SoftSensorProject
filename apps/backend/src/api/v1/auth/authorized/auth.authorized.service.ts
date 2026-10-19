import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt/dist/jwt.service';
import { AppException } from '@softsensor/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import { randomBytes, randomUUID } from 'crypto';
import { REFRESH_TOKEN_TTL_MS } from '@/config/cookie.config';
import { env } from '@/config/env.config';
import * as argon2 from 'argon2';
import {
  ChangePasswordRequestDto,
  EditRequestDto,
} from './dto/auth.authorized.dto';
import { MailAuthorizedService } from '../../mail/authorized/mail.authorized.service';

/**
 * How long a just-rotated refresh token is still honoured. Several requests
 * from one browser can refresh with the SAME token at nearly the same time
 * (NextAuth's session route, the page proxy and a polling screen each run
 * the jwt callback); without this, the first rotates it and every other one
 * gets a 401 and signs the user out. Inside the window they receive the token
 * it was rotated into; after it, reuse is refused as before.
 */
const ROTATION_GRACE_MS = 30_000;

/** Thrown inside the rotation transaction when another request rotated the
 *  same token first — the caller then answers from the grace path. */
class LostRotationRace extends Error {}

interface LogoutMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailAuthorizedService,
  ) {}

  async getMeService(args: Auth.UserPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: args.id },
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
      type: 'SUCCESS' as const,
      data: user,
    };
  }

  async editMeService(userId: string, data: EditRequestDto) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        company: data.company,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        role: true,
      },
    });

    return {
      statusCode: 200,
      message: 'อัปเดตข้อมูลผู้ใช้สำเร็จ',
      type: 'SUCCESS',
      data: updatedUser,
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
    const invalid = () =>
      new AppException({
        statusCode: 401,
        message: 'Refresh token invalid or expired',
        type: 'ERROR',
      });

    const record = await this.prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!record || record.expiresAt < new Date()) throw invalid();

    if (record.revokedAt) {
      const replacement = await this.graceReplacement(record);
      if (!replacement) throw invalid();
      return this.refreshResult(record.user, replacement);
    }

    const now = new Date();
    const newId = randomUUID();
    const newRefreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Compare-and-swap: only the request that still sees the token
        // unrevoked rotates it. A concurrent one finds count 0 and falls back
        // to the grace path below instead of minting a second successor.
        const { count } = await tx.refreshToken.updateMany({
          where: { token, revokedAt: null },
          data: { revokedAt: now, replacedById: newId },
        });
        if (count === 0) throw new LostRotationRace();
        await tx.refreshToken.create({
          data: {
            id: newId,
            token: newRefreshToken,
            userId: record.userId,
            expiresAt,
          },
        });
        // Rotated tokens are kept only for the grace window; older ones of
        // this user are dropped here so the table does not grow per refresh.
        await tx.refreshToken.deleteMany({
          where: {
            userId: record.userId,
            revokedAt: { lt: new Date(now.getTime() - ROTATION_GRACE_MS) },
          },
        });
      });
    } catch (err) {
      if (!(err instanceof LostRotationRace)) throw err;
      const rotated = await this.prisma.refreshToken.findUnique({
        where: { token },
      });
      const replacement = rotated ? await this.graceReplacement(rotated) : null;
      if (!replacement) throw invalid();
      return this.refreshResult(record.user, replacement);
    }

    return this.refreshResult(record.user, newRefreshToken);
  }

  /**
   * The token a revoked one was rotated into, if the rotation is recent
   * enough to be a race rather than a replay: within `ROTATION_GRACE_MS`, and
   * only while that successor is itself still live.
   */
  private async graceReplacement(record: {
    revokedAt: Date | null;
    replacedById: string | null;
  }): Promise<string | null> {
    if (!record.revokedAt || !record.replacedById) return null;
    if (Date.now() - record.revokedAt.getTime() > ROTATION_GRACE_MS) {
      return null;
    }
    const next = await this.prisma.refreshToken.findUnique({
      where: { id: record.replacedById },
    });
    if (!next || next.revokedAt || next.expiresAt < new Date()) return null;
    return next.token;
  }

  private refreshResult(
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      company: string | null;
      role: Auth.UserPayload['role'];
    },
    refreshToken: string,
  ): { response: object; refreshToken: string } {
    const accessToken = this.jwtService.sign<Auth.UserPayload>(
      {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        company: user.company ?? '',
        role: user.role,
      },
      { expiresIn: env.JWT_ACCESS_EXPIRES },
    );
    return {
      response: {
        statusCode: 200,
        message: 'Token refreshed successfully',
        type: 'SUCCESS',
        data: { accessToken },
      },
      refreshToken,
    };
  }

  async forgotPasswordService(email: string) {
    const silentSuccess = {
      statusCode: 200,
      message: 'เราได้ส่งอีเมลสำหรับรีเซ็ตรหัสผ่านไปให้แล้ว',
      type: 'SUCCESS',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return silentSuccess;

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000';
    const resetUrl = `${clientUrl}/auth/reset-password/${token}?email=${encodeURIComponent(user.email)}`;

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      }),
    ]);

    await this.mailerService.sendPasswordResetEmail(email, resetUrl);

    return silentSuccess;
  }

  async changePasswordService(
    users: Auth.UserPayload,
    args: ChangePasswordRequestDto,
  ) {
    const { newPassword, currentPassword } = args;

    const user = await this.prisma.user.findUnique({
      where: { id: users.id },
      include: { passwordResetTokens: true },
    });

    if (!user) {
      throw new AppException({
        statusCode: 404,
        message: 'User not found',
        type: 'ERROR',
      });
    }
    const isCurrentPasswordValid = await argon2.verify(
      user.password as string,
      currentPassword,
    );

    if (!isCurrentPasswordValid) {
      throw new AppException({
        statusCode: 400,
        message: 'Current password is incorrect',
        type: 'ERROR',
      });
    }

    const newHashedPassword = await argon2.hash(newPassword);

    await this.prisma.user.update({
      where: { id: users.id },
      data: { password: newHashedPassword },
    });

    return {
      statusCode: 200,
      message: 'เปลี่ยนรหัสผ่านสำเร็จ',
      type: 'SUCCESS',
    };
  }
}
