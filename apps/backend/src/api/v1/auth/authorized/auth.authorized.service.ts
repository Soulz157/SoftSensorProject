import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt/dist/jwt.service';
import { AppException } from '@softsensor/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import { randomBytes } from 'crypto';
import { REFRESH_TOKEN_TTL_MS } from '@/config/cookie.config';
import * as argon2 from 'argon2';
import {
  ChangePasswordRequestDto,
  EditRequestDto,
} from './dto/auth.authorized.dto';
import { MailAuthorizedService } from '../../mail/authorized/mail.authorized.service';

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
      type: 'SUCCESS',
      data: user,
    };
  }

  async editMeService(userId: string, data: EditRequestDto) {
    try {
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

      if (!updatedUser) {
        throw new AppException({
          statusCode: 404,
          message: 'User not found',
          type: 'ERROR',
        });
      }
    } catch (error) {
      throw new AppException({
        statusCode: 500,
        message: 'Failed to update user information',
        data: error instanceof Error ? error.message : String(error),
        type: 'ERROR',
      });
    }

    return {
      statusCode: 200,
      message: 'อัปเดตข้อมูลผู้ใช้สำเร็จ',
      type: 'SUCCESS',
    };
  }

  async logoutService(userId: string, meta?: LogoutMeta) {
    try {
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
    } catch (error) {
      throw new AppException({
        statusCode: 500,
        message: 'Logout failed',
        data: error instanceof Error ? error.message : String(error),
        type: 'ERROR',
      });
    }

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
    const resetUrl = `${clientUrl}/reset-password/${token}?email=${encodeURIComponent(user.email)}`;

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
