import { Injectable } from '@nestjs/common';
import { AppException } from '@softsensor/common/dist/custom/filter';
import { PrismaEnums, PrismaService } from '@softsensor/prisma';
import {
  CreateWorkspaceRequestDto,
  DeleteWorkspaceRequestDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace.admin.dto';

@Injectable()
export class WorkspaceAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(
    user: Auth.UserPayload,
    args: CreateWorkspaceRequestDto,
  ) {
    console.log('Creating workspace with args:', args);
    // if (user.role !== PrismaEnums.Role.ADMIN) {
    //   throw new AppException({
    //     statusCode: 403,
    //     message: 'Forbidden',
    //     type: 'ERROR',
    //   });
    // }

    const { name, color, icon } = args;

    const workspace = await this.prisma.workspace.create({
      data: {
        name,
        color,
        icon,
        ownerId: user.id,
      },
      select: {
        id: true,
        name: true,
        color: true,
        icon: true,
      },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 500,
        message: 'Failed to create workspace',
        type: 'ERROR',
      });
    }

    return {
      statusCode: 201,
      message: 'สร้าง workspace สำเร็จ',
      type: 'SUCCESS',
      data: workspace,
    };
  }

  async deleteWorkspace(
    user: Auth.UserPayload,
    args: DeleteWorkspaceRequestDto,
  ) {
    if (user.role !== PrismaEnums.Role.ADMIN) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
    }
    const { workspaceId } = args;

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: { deletedAt: new Date() },
    });

    return {
      statusCode: 200,
      message: 'Workspace deleted successfully',
      type: 'SUCCESS',
    };
  }

  async updateWorkspace(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceRequestDto,
  ) {
    if (user.role !== PrismaEnums.Role.ADMIN) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
    });

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }

    const { name, color, icon } = args;

    await this.prisma.workspace.update({
      where: { id },
      data: {
        name,
        color,
        icon,
      },
    });

    return {
      statusCode: 200,
      message: 'Workspace updated successfully',
      type: 'SUCCESS',
    };
  }
}
