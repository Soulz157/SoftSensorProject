# Admin Workspace Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the admin workspace settings page (`/admin/workspaces/[id]/settings`) to the database so all fields populate and all mutations work for any workspace, regardless of admin membership.

**Architecture:** Add five admin-only endpoints under `PATCH/GET /api/v1/admin/workspace/:id` and `/api/v1/admin/workspace/:id/members`, backed by a new service layer that skips membership checks. The frontend swaps the existing `useWorkspaceSettings` hook for a new `useAdminWorkspaceSettings` hook that calls these admin endpoints. A `description` field is added to the `Workspace` schema via migration.

**Tech Stack:** NestJS 11 + Prisma (backend), Next.js 16 App Router + NextAuth + Sonner toast (frontend), nestjs-zod for DTO validation, pnpm monorepo.

---

## File Map

| Action | Path                                                                         |
| ------ | ---------------------------------------------------------------------------- |
| Modify | `packages/prisma/prisma/schema.prisma`                                       |
| Modify | `apps/backend/src/api/v1/workspace/admin/dto/workspace.admin.dto.ts`         |
| Modify | `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.ts`         |
| Modify | `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.ts`      |
| Modify | `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.spec.ts`    |
| Modify | `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.spec.ts` |
| Modify | `apps/client/types/index.ts`                                                 |
| Modify | `apps/client/services/workspace.ts`                                          |
| Create | `apps/client/hooks/admin/use-admin-workspace-settings.ts`                    |
| Modify | `apps/client/app/admin/workspaces/[id]/settings/page.tsx`                    |

---

## Task 1: Prisma schema — add description field

**Files:**

- Modify: `packages/prisma/prisma/schema.prisma`

- [ ] **Step 1: Add description to Workspace model**

In `packages/prisma/prisma/schema.prisma`, inside the `Workspace` model, add after the `color` line:

```prisma
model Workspace {
  id          String         @id @default(uuid())
  ownerId     String
  owner       User           @relation(fields: [ownerId], references: [id])
  name        String
  icon        String
  color       String
  description String?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  deletedAt   DateTime?
  models      Model[]
  logs        WorkspaceLog[]
  members     WorkspaceMember[]

  @@index([ownerId])
}
```

- [ ] **Step 2: Run migration**

```bash
pnpm db:migrate:dev
```

When prompted for a migration name, enter: `add_workspace_description`

Expected: Migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add packages/prisma/prisma/schema.prisma packages/prisma/prisma/migrations/
git commit -m "feat(prisma): add optional description field to Workspace"
```

---

## Task 2: Backend DTOs — new schemas and update existing

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/admin/dto/workspace.admin.dto.ts`

- [ ] **Step 1: Write failing test for new DTOs**

In `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.spec.ts`, verify the service can be imported (since DTOs are imported by service). The build itself is the test here — run:

```bash
pnpm --filter backend build 2>&1 | head -30
```

Expected: Errors about missing types (since we haven't updated them yet). This confirms the test is "failing".

- [ ] **Step 2: Update the DTO file**

Replace the full content of `apps/backend/src/api/v1/workspace/admin/dto/workspace.admin.dto.ts`:

```typescript
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { createStandardResponseSchema } from 'src/lib/dto'

const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const AdminWorkspaceQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
})

export const AdminWorkspaceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  createdAt: z.date(),
  owner: z.object({
    id: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string(),
  }),
  _count: z.object({ models: z.number().int() }),
})

export const AdminWorkspaceListResponseSchema = createStandardResponseSchema(
  z.object({
    items: z.array(AdminWorkspaceItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
  }),
)

export const AdminWorkspaceMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(['OWNER', 'VIEWER']),
  createdAt: z.date(),
  user: z.object({
    id: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    email: z.string(),
  }),
})

export const AdminWorkspaceDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  _count: z.object({
    members: z.number().int(),
    models: z.number().int(),
  }),
  members: z.array(AdminWorkspaceMemberSchema),
})

export const AdminGetWorkspaceByIdResponseSchema = createStandardResponseSchema(
  AdminWorkspaceDetailSchema,
)

export const CreateWorkspaceResponseSchema = createStandardResponseSchema(
  z.object({
    workspaceId: z.string(),
    message: z.string(),
  }),
)

export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1, 'ชื่อ workspace ต้องไม่ว่างเปล่า'),
  color: z.string().min(1, 'สี workspace ต้องไม่ว่างเปล่า'),
  icon: z.string().min(1, 'ไอคอน workspace ต้องไม่ว่างเปล่า'),
})

export const UpdateWorkspaceRequestSchema = z.object({
  name: z.string().min(1, 'ชื่อ workspace ต้องไม่ว่างเปล่า').optional(),
  color: z.string().min(1, 'สี workspace ต้องไม่ว่างเปล่า').optional(),
  icon: z.string().min(1, 'ไอคอน workspace ต้องไม่ว่างเปล่า').optional(),
  description: z.string().nullable().optional(),
})

export const DeleteWorkspaceRequestSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId ต้องไม่ว่างเปล่า'),
})

export const DeleteWorkspaceResponseSchema = createStandardResponseSchema(
  z.object({ message: z.string() }),
)

export const AdminInviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['OWNER', 'VIEWER']),
})

export const AdminUpdateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'VIEWER']),
})

export class AdminWorkspaceQueryDto extends createZodDto(
  AdminWorkspaceQuerySchema,
) {}
export class AdminWorkspaceListResponseDto extends createZodDto(
  AdminWorkspaceListResponseSchema,
) {}
export class AdminGetWorkspaceByIdResponseDto extends createZodDto(
  AdminGetWorkspaceByIdResponseSchema,
) {}
export class CreateWorkspaceRequestDto extends createZodDto(
  CreateWorkspaceRequestSchema,
) {}
export class CreateWorkspaceResponseDto extends createZodDto(
  CreateWorkspaceResponseSchema,
) {}
export class UpdateWorkspaceRequestDto extends createZodDto(
  UpdateWorkspaceRequestSchema,
) {}
export class DeleteWorkspaceRequestDto extends createZodDto(
  DeleteWorkspaceRequestSchema,
) {}
export class DeleteWorkspaceResponseDto extends createZodDto(
  DeleteWorkspaceResponseSchema,
) {}
export class AdminInviteMemberDto extends createZodDto(
  AdminInviteMemberSchema,
) {}
export class AdminUpdateMemberRoleDto extends createZodDto(
  AdminUpdateMemberRoleSchema,
) {}
```

- [ ] **Step 3: Verify build passes for DTOs**

```bash
pnpm --filter backend build 2>&1 | head -30
```

Expected: No errors from the DTO file.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/api/v1/workspace/admin/dto/workspace.admin.dto.ts
git commit -m "feat(workspace/admin): add DTOs for workspace detail and member management"
```

---

## Task 3: Backend service — getWorkspaceById + fix updateWorkspace

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.ts`

- [ ] **Step 1: Write failing test for getWorkspaceById**

In `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.spec.ts`, add inside `describe('WorkspaceAdminService', ...)`:

```typescript
describe('getWorkspaceById', () => {
  it('throws 404 when workspace not found', async () => {
    const prisma = module.get<PrismaService>(PrismaService)
    ;(prisma.workspace.findUnique as jest.Mock).mockResolvedValue(null)

    await expect(service.getWorkspaceById('missing-id')).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('returns workspace with members when found', async () => {
    const prisma = module.get<PrismaService>(PrismaService)
    const mockWorkspace = {
      id: 'ws-1',
      name: 'Test',
      icon: 'cpu',
      color: 'blue',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { members: 1, models: 0 },
      members: [],
    }
    ;(prisma.workspace.findUnique as jest.Mock).mockResolvedValue(mockWorkspace)

    const result = await service.getWorkspaceById('ws-1')
    expect(result.statusCode).toBe(200)
    expect(result.data).toEqual(mockWorkspace)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace.admin.service
```

Expected: FAIL — `service.getWorkspaceById is not a function`.

- [ ] **Step 3: Implement getWorkspaceById + fix updateWorkspace**

Replace the full content of `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.ts`:

```typescript
import { Injectable } from '@nestjs/common'
import { AppException } from '@softsensor/common'
import { PrismaService } from '@softsensor/prisma'
import {
  AdminInviteMemberDto,
  AdminUpdateMemberRoleDto,
  AdminWorkspaceQueryDto,
  CreateWorkspaceRequestDto,
  DeleteWorkspaceRequestDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace.admin.dto'

@Injectable()
export class WorkspaceAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkspaces(args: AdminWorkspaceQueryDto) {
    const { page, limit, search } = args
    const where = {
      deletedAt: null,
      ...(search
        ? { name: { contains: search, mode: 'insensitive' as const } }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          _count: { select: { models: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workspace.count({ where }),
    ])

    return {
      statusCode: 200,
      message: 'Workspaces fetched successfully',
      type: 'SUCCESS' as const,
      data: { items, total, page, limit },
    }
  }

  async getWorkspaceById(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, models: true } },
        members: {
          select: {
            id: true,
            userId: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }

    return {
      statusCode: 200,
      message: 'Workspace fetched successfully',
      type: 'SUCCESS' as const,
      data: workspace,
    }
  }

  async createWorkspace(
    user: Auth.UserPayload,
    args: CreateWorkspaceRequestDto,
  ) {
    const { name, color, icon } = args

    const [workspace] = await this.prisma.$transaction([
      this.prisma.workspace.create({
        data: {
          name,
          color,
          icon,
          ownerId: user.id,
          members: {
            create: { userId: user.id, role: 'OWNER' },
          },
        },
        select: { id: true, name: true, color: true, icon: true },
      }),
    ])

    return {
      statusCode: 201,
      message: 'สร้าง workspace สำเร็จ',
      type: 'SUCCESS' as const,
      data: workspace,
    }
  }

  async updateWorkspace(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceRequestDto,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }

    const { name, color, icon, description } = args

    await this.prisma.$transaction([
      this.prisma.workspace.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(color !== undefined && { color }),
          ...(icon !== undefined && { icon }),
          ...(description !== undefined && { description }),
        },
      }),
      this.prisma.workspaceLog.create({
        data: {
          workspaceId: id,
          userId: user.id,
          action: 'UPDATED',
          details: `Workspace updated by ${user.firstName} ${user.lastName}`,
        },
      }),
    ])

    return {
      statusCode: 200,
      message: 'Workspace updated successfully',
      type: 'SUCCESS' as const,
    }
  }

  async deleteWorkspace(
    user: Auth.UserPayload,
    args: DeleteWorkspaceRequestDto,
  ) {
    const { workspaceId } = args

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    })

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }

    await this.prisma.workspace.update({
      where: { id: workspace.id },
      data: { deletedAt: new Date() },
    })

    return {
      statusCode: 200,
      message: 'Workspace deleted successfully',
      type: 'SUCCESS' as const,
    }
  }

  async inviteMember(workspaceId: string, dto: AdminInviteMemberDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true },
    })
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }

    const target = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    })
    if (!target) {
      throw new AppException({
        statusCode: 404,
        message: 'User not found',
        type: 'ERROR',
      })
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: target.id } },
    })
    if (existing) {
      throw new AppException({
        statusCode: 409,
        message: 'User is already a member',
        type: 'ERROR',
      })
    }

    const member = await this.prisma.workspaceMember.create({
      data: { workspaceId, userId: target.id, role: dto.role },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    })

    return {
      statusCode: 201,
      message: 'Member invited successfully',
      type: 'SUCCESS' as const,
      data: member,
    }
  }

  async updateMemberRole(
    workspaceId: string,
    memberId: string,
    dto: AdminUpdateMemberRoleDto,
  ) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    })
    if (!member) {
      throw new AppException({
        statusCode: 404,
        message: 'Member not found',
        type: 'ERROR',
      })
    }

    if (member.role === 'OWNER' && dto.role !== 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      })
      if (ownerCount <= 1) {
        throw new AppException({
          statusCode: 400,
          message: 'Cannot demote the last owner',
          type: 'ERROR',
        })
      }
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      select: {
        id: true,
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    })

    return {
      statusCode: 200,
      message: 'Member role updated',
      type: 'SUCCESS' as const,
      data: updated,
    }
  }

  async removeMember(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    })
    if (!member) {
      throw new AppException({
        statusCode: 404,
        message: 'Member not found',
        type: 'ERROR',
      })
    }

    if (member.role === 'OWNER') {
      const ownerCount = await this.prisma.workspaceMember.count({
        where: { workspaceId, role: 'OWNER' },
      })
      if (ownerCount <= 1) {
        throw new AppException({
          statusCode: 400,
          message: 'Cannot remove the last owner',
          type: 'ERROR',
        })
      }
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } })

    return {
      statusCode: 200,
      message: 'Member removed',
      type: 'SUCCESS' as const,
      data: null,
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace.admin.service
```

Expected: PASS — `getWorkspaceById throws 404` and `returns workspace`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/v1/workspace/admin/workspace.admin.service.ts \
        apps/backend/src/api/v1/workspace/admin/workspace.admin.service.spec.ts
git commit -m "feat(workspace/admin): add getWorkspaceById and member management to service"
```

---

## Task 4: Backend controller — add new endpoints

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.ts`
- Modify: `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.spec.ts`

- [ ] **Step 1: Write failing test for new controller methods**

In `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.spec.ts`, replace the full file:

```typescript
import { Test, TestingModule } from '@nestjs/testing'
import { WorkspaceAdminController } from './workspace.admin.controller'
import { WorkspaceAdminService } from './workspace.admin.service'

jest.mock('@softsensor/common', () => ({
  AppException: class AppException extends Error {
    readonly statusCode: number
    readonly type: string
    constructor(body: { statusCode: number; message: string; type: string }) {
      super(body.message)
      this.statusCode = body.statusCode
      this.type = body.type
    }
  },
}))

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
  PrismaEnums: { Role: { USER: 'USER', STAFF: 'STAFF', ADMIN: 'ADMIN' } },
}))

jest.mock('@/guards/jwt-access.guard', () => ({
  JwtAccessGuard: class JwtAccessGuard {
    canActivate() {
      return true
    }
  },
}))

jest.mock('@/guards/roles.guard', () => ({
  RolesGuard: class RolesGuard {
    canActivate() {
      return true
    }
  },
}))

jest.mock('@/common/decorators/user.decorator', () => ({
  Users: () => jest.fn(),
}))

jest.mock('@/common/decorators/roles.decorator', () => ({
  Roles: () => jest.fn(),
}))

jest.mock('@/lib/dto', () => ({
  ResponseFailedDto: class ResponseFailedDto {},
}))

jest.mock('@nestjs/swagger', () => ({
  ApiTags: () => jest.fn(),
  ApiOperation: () => jest.fn(),
  ApiOkResponse: () => jest.fn(),
  ApiBadRequestResponse: () => jest.fn(),
  ApiBearerAuth: () => jest.fn(),
}))

jest.mock('./dto/workspace.admin.dto', () => ({
  CreateWorkspaceRequestDto: class CreateWorkspaceRequestDto {},
  CreateWorkspaceResponseDto: class CreateWorkspaceResponseDto {},
  UpdateWorkspaceRequestDto: class UpdateWorkspaceRequestDto {},
  DeleteWorkspaceRequestDto: class DeleteWorkspaceRequestDto {},
  DeleteWorkspaceResponseDto: class DeleteWorkspaceResponseDto {},
  AdminGetWorkspaceByIdResponseDto: class AdminGetWorkspaceByIdResponseDto {},
  AdminInviteMemberDto: class AdminInviteMemberDto {},
  AdminUpdateMemberRoleDto: class AdminUpdateMemberRoleDto {},
}))

describe('WorkspaceAdminController', () => {
  let controller: WorkspaceAdminController
  let service: WorkspaceAdminService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceAdminController],
      providers: [
        {
          provide: WorkspaceAdminService,
          useValue: {
            listWorkspaces: jest.fn(),
            getWorkspaceById: jest.fn(),
            createWorkspace: jest.fn(),
            updateWorkspace: jest.fn(),
            deleteWorkspace: jest.fn(),
            inviteMember: jest.fn(),
            updateMemberRole: jest.fn(),
            removeMember: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get<WorkspaceAdminController>(WorkspaceAdminController)
    service = module.get<WorkspaceAdminService>(WorkspaceAdminService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('getWorkspaceById delegates to service', async () => {
    const mockResult = { statusCode: 200, data: { id: 'ws-1' } }
    ;(service.getWorkspaceById as jest.Mock).mockResolvedValue(mockResult)
    const result = await controller.getWorkspaceById('ws-1')
    expect(service.getWorkspaceById).toHaveBeenCalledWith('ws-1')
    expect(result).toEqual(mockResult)
  })

  it('inviteMember delegates to service', async () => {
    const dto = { email: 'a@b.com', role: 'VIEWER' as const }
    const mockResult = { statusCode: 201, data: { id: 'm-1' } }
    ;(service.inviteMember as jest.Mock).mockResolvedValue(mockResult)
    const result = await controller.inviteMember('ws-1', dto as never)
    expect(service.inviteMember).toHaveBeenCalledWith('ws-1', dto)
    expect(result).toEqual(mockResult)
  })

  it('updateMemberRole delegates to service', async () => {
    const dto = { role: 'OWNER' as const }
    const mockResult = { statusCode: 200, data: { id: 'm-1' } }
    ;(service.updateMemberRole as jest.Mock).mockResolvedValue(mockResult)
    const result = await controller.updateMemberRole(
      'ws-1',
      'm-1',
      dto as never,
    )
    expect(service.updateMemberRole).toHaveBeenCalledWith('ws-1', 'm-1', dto)
    expect(result).toEqual(mockResult)
  })

  it('removeMember delegates to service', async () => {
    const mockResult = { statusCode: 200, data: null }
    ;(service.removeMember as jest.Mock).mockResolvedValue(mockResult)
    const result = await controller.removeMember('ws-1', 'm-1')
    expect(service.removeMember).toHaveBeenCalledWith('ws-1', 'm-1')
    expect(result).toEqual(mockResult)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace.admin.controller
```

Expected: FAIL — methods `getWorkspaceById`, `inviteMember`, `updateMemberRole`, `removeMember` not found on controller.

- [ ] **Step 3: Update the controller**

Replace the full content of `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { WorkspaceAdminService } from './workspace.admin.service'
import { Users } from '@/common/decorators/user.decorator'
import { ApiBadRequestResponse, ApiOkResponse } from '@nestjs/swagger'
import { ResponseFailedDto } from '@/lib/dto'
import {
  AdminGetWorkspaceByIdResponseDto,
  AdminInviteMemberDto,
  AdminUpdateMemberRoleDto,
  AdminWorkspaceListResponseDto,
  AdminWorkspaceQueryDto,
  CreateWorkspaceRequestDto,
  CreateWorkspaceResponseDto,
  DeleteWorkspaceRequestDto,
  DeleteWorkspaceResponseDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace.admin.dto'
import { JwtAccessGuard } from '@/guards/jwt-access.guard'
import { RolesGuard } from '@/guards/roles.guard'
import { Roles } from '@/common/decorators/roles.decorator'

@Controller('admin/workspace')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles('ADMIN')
export class WorkspaceAdminController {
  constructor(private readonly workspaceAdminService: WorkspaceAdminService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminWorkspaceListResponseDto })
  async listWorkspaces(@Query() query: AdminWorkspaceQueryDto) {
    return this.workspaceAdminService.listWorkspaces(query)
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminGetWorkspaceByIdResponseDto })
  async getWorkspaceById(@Param('id') id: string) {
    return this.workspaceAdminService.getWorkspaceById(id)
  }

  @Post('/create')
  @HttpCode(201)
  @ApiOkResponse({ type: CreateWorkspaceResponseDto })
  @ApiBadRequestResponse({ type: ResponseFailedDto })
  async createWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: CreateWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.createWorkspace(user, args)
  }

  @Patch('/:id')
  @HttpCode(200)
  async updateWorkspace(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() args: UpdateWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.updateWorkspace(id, user, args)
  }

  @Post('/:id/members')
  @HttpCode(201)
  async inviteMember(
    @Param('id') id: string,
    @Body() body: AdminInviteMemberDto,
  ) {
    return this.workspaceAdminService.inviteMember(id, body)
  }

  @Patch('/:id/members/:mid')
  @HttpCode(200)
  async updateMemberRole(
    @Param('id') id: string,
    @Param('mid') mid: string,
    @Body() body: AdminUpdateMemberRoleDto,
  ) {
    return this.workspaceAdminService.updateMemberRole(id, mid, body)
  }

  @Delete('/:id/members/:mid')
  @HttpCode(200)
  async removeMember(@Param('id') id: string, @Param('mid') mid: string) {
    return this.workspaceAdminService.removeMember(id, mid)
  }

  @Delete('/delete')
  @HttpCode(200)
  @ApiOkResponse({ type: DeleteWorkspaceResponseDto })
  @ApiBadRequestResponse({ type: ResponseFailedDto })
  async deleteWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: DeleteWorkspaceRequestDto,
  ) {
    return this.workspaceAdminService.deleteWorkspace(user, args)
  }
}
```

> **Note on route ordering:** `GET /:id` vs `GET /` — NestJS matches specific paths before wildcard params so this is safe. `DELETE /delete` vs `DELETE /:id/members/:mid` — different segment counts, no conflict.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace.admin.controller
```

Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.ts \
        apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.spec.ts
git commit -m "feat(workspace/admin): add GET /:id and member management endpoints"
```

---

## Task 5: Frontend types

**Files:**

- Modify: `apps/client/types/index.ts`

- [ ] **Step 1: Update types**

In `apps/client/types/index.ts`, make these three changes:

**1. Extend `WorkspaceDetail`** (around line 91):

```typescript
export interface WorkspaceDetail {
  id: string
  name: string
  icon: string
  color: string
  description: string | null
  createdAt: string
  updatedAt: string
  _count: { members: number; models: number }
}
```

**2. Add `AdminWorkspaceDetail`** (add after `WorkspaceDetail`):

```typescript
export interface AdminWorkspaceDetail {
  id: string
  name: string
  icon: string
  color: string
  description: string | null
  createdAt: string
  updatedAt: string
  _count: { members: number; models: number }
  members: WorkspaceMember[]
}
```

**3. Extend `UpdateWorkspacePayload`** (around line 53):

```typescript
export interface UpdateWorkspacePayload {
  name?: string
  icon?: string
  color?: string
  description?: string | null
}
```

- [ ] **Step 2: Verify no type errors**

```bash
pnpm --filter client check-types 2>&1 | head -30
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/types/index.ts
git commit -m "feat(types): add AdminWorkspaceDetail, description to WorkspaceDetail and UpdateWorkspacePayload"
```

---

## Task 6: Frontend service methods

**Files:**

- Modify: `apps/client/services/workspace.ts`

- [ ] **Step 1: Add admin service methods**

In `apps/client/services/workspace.ts`, add these four methods inside the `workspaceService` object (after the existing `removeMember` entry):

```typescript
  getAdminWorkspaceById: (id: string): Promise<{ data: AdminWorkspaceDetail }> =>
    fetchClient(`/api/v1/admin/workspace/${id}`, { method: 'GET' }),

  adminInviteMember: (
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(`/api/v1/admin/workspace/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),

  adminUpdateMemberRole: (
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<{ data: WorkspaceMember }> =>
    fetchClient(
      `/api/v1/admin/workspace/${workspaceId}/members/${memberId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),

  adminRemoveMember: (
    workspaceId: string,
    memberId: string,
  ): Promise<unknown> =>
    fetchClient(
      `/api/v1/admin/workspace/${workspaceId}/members/${memberId}`,
      { method: 'DELETE' },
    ),
```

Also add `AdminWorkspaceDetail` to the existing import at the top of the file:

```typescript
import type {
  AdminWorkspace,
  AdminWorkspaceDetail,
  CreateWorkspaceInput,
  Paginated,
  UpdateWorkspacePayload,
  Workspace,
  WorkspaceDetail,
  WorkspaceLog,
  WorkspaceMember,
  WorkspaceModel,
  WorkspaceRole,
} from '@/types'
```

- [ ] **Step 2: Verify no type errors**

```bash
pnpm --filter client check-types 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/services/workspace.ts
git commit -m "feat(services): add admin workspace and member management methods"
```

---

## Task 7: New hook — useAdminWorkspaceSettings

**Files:**

- Create: `apps/client/hooks/admin/use-admin-workspace-settings.ts`

- [ ] **Step 1: Create the hook**

Create `apps/client/hooks/admin/use-admin-workspace-settings.ts` with this content:

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspaceDetail, WorkspaceMember } from '@/types'

export function useAdminWorkspaceSettings(workspaceId: string) {
  const { status } = useSession()
  const [workspace, setWorkspace] = useState<AdminWorkspaceDetail | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedIcon, setSelectedIcon] = useState('')
  const [selectedColor, setSelectedColor] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await workspaceService.getAdminWorkspaceById(workspaceId)
      setWorkspace(res.data)
      setName(res.data.name)
      setDescription(res.data.description ?? '')
      setSelectedIcon(res.data.icon)
      setSelectedColor(res.data.color)
      setMembers(res.data.members)
    } catch {
      toast.error('Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (status === 'loading') return
    queueMicrotask(() => {
      if (status !== 'authenticated') return
      loadData()
    })
  }, [loadData, status])

  return {
    workspace,
    members,
    setMembers,
    loading,
    name,
    setName,
    description,
    setDescription,
    selectedIcon,
    setSelectedIcon,
    selectedColor,
    setSelectedColor,
    refetch: loadData,
  }
}
```

- [ ] **Step 2: Verify no type errors**

```bash
pnpm --filter client check-types 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/hooks/admin/use-admin-workspace-settings.ts
git commit -m "feat(hooks): add useAdminWorkspaceSettings hook"
```

---

## Task 8: Update admin settings page

**Files:**

- Modify: `apps/client/app/admin/workspaces/[id]/settings/page.tsx`

- [ ] **Step 1: Update imports at top of file**

Replace the import block at the top of `apps/client/app/admin/workspaces/[id]/settings/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity,
  BrainCircuit,
  Loader2,
  Palette,
  Save,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { workspaceService } from '@/services/workspace'
import { workspaceColors, workspaceIcons } from '@/store/workspace'
import { useAdminWorkspaceSettings } from '@/hooks/admin/use-admin-workspace-settings'
import type { WorkspaceRole } from '@/types'
```

- [ ] **Step 2: Update hook call and add description state**

Replace the hook destructuring (around line 55–69) with:

```typescript
const {
  workspace,
  members,
  setMembers,
  loading,
  name,
  setName,
  description,
  setDescription,
  selectedIcon,
  setSelectedIcon,
  selectedColor,
  setSelectedColor,
} = useAdminWorkspaceSettings(workspaceId)
```

- [ ] **Step 3: Update handleSave to include description**

Replace the `handleSave` function:

```typescript
async function handleSave() {
  if (!name.trim()) {
    toast.error('Workspace name is required')
    return
  }
  setIsSaving(true)
  try {
    await workspaceService.updateWorkspace(workspaceId, {
      name,
      icon: selectedIcon,
      color: selectedColor,
      description: description || null,
    })
    toast.success('Workspace updated')
  } catch {
    toast.error('Failed to update workspace')
  } finally {
    setIsSaving(false)
  }
}
```

- [ ] **Step 4: Replace member mutation calls with admin service methods**

Replace `handleRemoveMember`:

```typescript
async function handleRemoveMember(memberId: string) {
  try {
    await workspaceService.adminRemoveMember(workspaceId, memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
    toast.success('Member removed')
  } catch {
    toast.error('Failed to remove member')
  }
}
```

Replace `handleRoleChange`:

```typescript
async function handleRoleChange(memberId: string, role: WorkspaceRole) {
  try {
    const res = await workspaceService.adminUpdateMemberRole(
      workspaceId,
      memberId,
      role,
    )
    setMembers(prev => prev.map(m => (m.id === memberId ? res.data : m)))
  } catch {
    toast.error('Failed to update role')
  }
}
```

Replace `handleInvite`:

```typescript
async function handleInvite() {
  if (!inviteEmail.trim()) {
    toast.error('Email is required')
    return
  }
  setIsInviting(true)
  try {
    const res = await workspaceService.adminInviteMember(
      workspaceId,
      inviteEmail,
      inviteRole,
    )
    setMembers(prev => [...prev, res.data])
    setInviteEmail('')
    setInviteOpen(false)
    toast.success('Member invited')
  } catch {
    toast.error('Failed to invite member')
  } finally {
    setIsInviting(false)
  }
}
```

- [ ] **Step 5: Add Description textarea in JSX**

Inside the `CardContent` of "General Settings", add this block after the Name input block and before the Icon section:

```tsx
<div className="space-y-1.5">
  <label className="text-sm font-medium">Description</label>
  {loading ? (
    <Skeleton className="h-20 w-full" />
  ) : (
    <textarea
      className={`${inputClass} min-h-20 resize-none py-2`}
      value={description}
      onChange={e => setDescription(e.target.value)}
      placeholder="Optional workspace description…"
      rows={3}
    />
  )}
</div>
```

- [ ] **Step 6: Verify no type errors**

```bash
pnpm --filter client check-types 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/client/app/admin/workspaces/[id]/settings/page.tsx
git commit -m "feat(admin): wire workspace settings page to admin endpoints"
```

---

## Task 9: Final build verification

- [ ] **Step 1: Format all files**

```bash
pnpm format
```

Expected: Files formatted, no errors.

- [ ] **Step 2: Full build**

```bash
pnpm build
```

Expected: All packages build successfully with zero type errors.

- [ ] **Step 3: Run all backend tests**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace.admin
```

Expected: All workspace admin tests pass.

- [ ] **Step 4: Manual smoke test**

1. Start dev server: `pnpm dev`
2. Log in as ADMIN user
3. Navigate to `/admin/workspaces`
4. Click any workspace → Settings
5. Verify: Name, Description, Icon, Color, Members list, Overview stats all populate
6. Edit Name + Description → Save → reload page → verify values persisted
7. Invite a user by email → verify they appear in members list
8. Change a member's role → reload → verify role persisted
9. Remove a member → verify they are removed from the list
10. Test with a workspace the admin user is NOT a member of — all operations must succeed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: final format and build verification for admin workspace settings"
```
