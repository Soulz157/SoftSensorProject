import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { canReadWithGrant, canWriteBack } from '@/lib/workspace-permission';

/**
 * MODEL-SERVE-032. Who may touch a model's Evaluation page.
 *
 * READ is the monitoring rule the sibling inference routes already apply
 * (global ADMIN, the workspace owner, or a member; a VIEWER only with the
 * MONITORING_VIEW grant). One implementation here rather than another
 * private copy per service, because write-back adds a stricter rule beside
 * it and two services must not each decide what "may read" means.
 */
@Injectable()
export class ModelEvaluationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertRead(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return model;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return model;

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: model.workspaceId, userId: user.id },
    });
    if (!canReadWithGrant(member, 'MONITORING_VIEW')) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: monitoring access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  /**
   * Who may change what the model writes into the plant historian: global
   * ADMIN, the workspace owner, or an OWNER member (`canWriteBack`). STAFF
   * may edit the model but not this -- a PI write lands in production under
   * the data source creator's account.
   *
   * Always check this per route; a class-level guard would also cover the
   * read routes beside it.
   */
  async assertWriteBack(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    const allowed = await this.canWriteBackToModel(model.workspaceId, user);
    if (!allowed) {
      throw new AppException({
        statusCode: 403,
        message:
          'Forbidden: only a workspace owner or an admin can change PI write-back.',
        type: 'ERROR',
      });
    }
    return model;
  }

  /** The same decision as a boolean, for the UI's enabled / disabled state. */
  async canWriteBackToModel(
    workspaceId: string,
    user: Auth.UserPayload,
  ): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    const [workspace, member] = await Promise.all([
      this.prisma.workspace.findFirst({
        where: { id: workspaceId, ownerId: user.id },
        select: { id: true },
      }),
      this.prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: user.id },
        select: { role: true },
      }),
    ]);
    return canWriteBack({
      globalRole: user.role === 'ADMIN' ? 'ADMIN' : 'USER',
      isWorkspaceOwner: !!workspace,
      member,
    });
  }
}
