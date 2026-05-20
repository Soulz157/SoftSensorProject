import { Injectable } from '@nestjs/common';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';

interface LogoutMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

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
}
