import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common';
import { PrismaService } from '@softsensor/prisma';

@Injectable()
export class WorkspaceAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllWorkspaces(user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      });
    }
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        ownerId: user.id,
        deletedAt: null,
      },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
      },
    });

    if (!workspaces) {
      throw new AppException({
        statusCode: 404,
        message: 'No workspaces found',
        type: 'ERROR',
      });
    }
    return {
      statusCode: 200,
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS',
      data: workspaces,
    };
  }

  async getWorkspaceById(id: string, user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      });
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
      },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
    return {
      statusCode: 200,
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS',
      data: workspace,
    };
  }
}
