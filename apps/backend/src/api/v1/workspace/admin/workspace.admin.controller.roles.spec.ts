import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/guards/roles.guard';
import { WorkspaceAdminController } from './workspace.admin.controller';

// The real `Roles` decorator and `RolesGuard` are used on purpose — the
// sibling controller spec mocks both, so it cannot see a missing @Roles.

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {},
}));

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  PrismaEnums: { Role: { USER: 'USER', ADMIN: 'ADMIN' } },
}));

jest.mock('@/guards/jwt-access.guard', () => ({
  JwtAccessGuard: class JwtAccessGuard {},
}));

jest.mock('./workspace.admin.service', () => ({
  WorkspaceAdminService: class WorkspaceAdminService {},
}));

type Handler = keyof WorkspaceAdminController;

function contextFor(handler: Handler, role: string): ExecutionContext {
  return {
    getHandler: () => WorkspaceAdminController.prototype[handler],
    getClass: () => WorkspaceAdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceAdminController — ADMIN enforcement', () => {
  const guard = new RolesGuard(new Reflector());

  const adminOnly: Handler[] = [
    'listWorkspaces',
    'getSummary',
    'getWorkspaceById',
    'updateWorkspace',
    'inviteMember',
    'updateMemberRole',
    'moveMember',
    'removeMember',
    'deleteWorkspace',
  ];

  it.each(adminOnly)('%s refuses a USER', (handler) => {
    expect(guard.canActivate(contextFor(handler, 'USER'))).toBe(false);
  });

  it.each(adminOnly)('%s admits an ADMIN', (handler) => {
    expect(guard.canActivate(contextFor(handler, 'ADMIN'))).toBe(true);
  });

  it('createWorkspace stays open to a USER (onboarding path)', () => {
    expect(guard.canActivate(contextFor('createWorkspace', 'USER'))).toBe(true);
  });
});
