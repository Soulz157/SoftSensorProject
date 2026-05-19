import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';

@Injectable()
export class AuthAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    return null;
    // return this.prisma.user.findUnique({
    //   where: { id: userId },
    //   select: {
    //     id: true,
    //     email: true,
    //     firstname: true,
    //     lastname: true,
    //     role: true,
    //   },
    // });
  }
}
