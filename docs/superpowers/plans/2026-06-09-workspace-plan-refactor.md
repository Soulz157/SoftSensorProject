# WorkspacePlan Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert `WorkspacePlan` as a layer between `Workspace` and `Nodes`, update the dashboard 3D map to render Plans as zones with a drill-down to Equipment view.

**Architecture:** Schema-first top-down: Prisma schema → backend CRUD module → frontend types/services/state → dashboard UI. The isometric map is generalized to a `ZoneItem` interface so both `Workspace` and `WorkspacePlan` can be rendered as zones. Dashboard `page.tsx` owns `viewMode` (`'plans' | 'equipment'`) and `selectedPlanId` state; drilling down switches the map data source and the detail panel context.

**Tech Stack:** Prisma (PostgreSQL), NestJS 11 + Fastify, nestjs-zod, Next.js 16 App Router, Jotai, SVG isometric map (pure SVG), Vitest (client), Jest (backend)

---

## File Map

### Created

- `apps/backend/src/api/v1/workspace-plan/workspace-plan.module.ts`
- `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.controller.ts`
- `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.ts`
- `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.spec.ts`
- `apps/backend/src/api/v1/workspace-plan/authorized/dto/workspace-plan.authorized.dto.ts`
- `apps/client/services/workspace-plan.ts`
- `apps/client/hooks/workspace/use-workspace-plans.ts`

### Modified

- `packages/prisma/prisma/schema.prisma`
- `apps/backend/src/api/v1/nodes/authorized/dto/nodes.authorized.dto.ts`
- `apps/backend/src/api/v1/nodes/authorized/nodes.authorized.service.ts`
- `apps/backend/src/api/v1/nodes/authorized/nodes.authorized.controller.ts`
- `apps/backend/src/app.module.ts`
- `apps/client/types/index.ts`
- `apps/client/services/canvas.ts`
- `apps/client/store/workspace.ts`
- `apps/client/lib/isomatric.ts`
- `apps/client/hooks/use-dashboard-data.ts`
- `apps/client/app/(default)/dashboard/page.tsx`
- `apps/client/app/(default)/dashboard/components/isometric-map.tsx`
- `apps/client/app/(default)/dashboard/components/node-detail-panel.tsx`

---

## Task 1: Prisma Schema — Add WorkspacePlan Model

**Files:**

- Modify: `packages/prisma/prisma/schema.prisma`

- [ ] **Step 1: Add `WorkspacePlan` model and `plans` relation to `Workspace`**

In `packages/prisma/prisma/schema.prisma`, add the new model after the `Workspace` model and before `Nodes`:

```prisma
model WorkspacePlan {
  id          String    @id @default(uuid())
  workspaceId String
  name        String
  icon        String?
  color       String?
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  nodes     Nodes[]

  @@index([workspaceId])
}
```

Also add `plans WorkspacePlan[]` to the `Workspace` model relations block (after `edges Edge[]`):

```prisma
plans  WorkspacePlan[]
```

- [ ] **Step 2: Add `planId` to the `Nodes` model**

In the `Nodes` model, add `planId` field and `plan` relation (after `workspaceId` line):

```prisma
planId    String
plan      WorkspacePlan @relation(fields: [planId], references: [id], onDelete: Cascade)
```

Also add a new index (after `@@index([workspaceId])`):

```prisma
@@index([planId])
```

- [ ] **Step 3: Run migration**

```bash
pnpm db:migrate:dev
```

When prompted, name the migration: `add_workspace_plan`

Expected output ends with: `Your database is now in sync with your schema.`

- [ ] **Step 4: Verify generated client has WorkspacePlan**

```bash
grep -r "WorkspacePlan" packages/prisma/src/generated/client/index.d.ts | head -5
```

Expected: lines containing `WorkspacePlan` type definitions.

- [ ] **Step 5: Commit**

```bash
git add packages/prisma/prisma/schema.prisma packages/prisma/src/generated/
git commit -m "feat(prisma): add WorkspacePlan model with planId FK on Nodes"
```

---

## Task 2: Scaffold WorkspacePlan NestJS Module

**Files:**

- Create: all files under `apps/backend/src/api/v1/workspace-plan/`

- [ ] **Step 1: Run setup.sh**

```bash
cd apps/backend && bash setup.sh workspace-plan
```

Expected: console output showing generated files for module, controllers, services, DTOs in `src/api/v1/workspace-plan/`.

- [ ] **Step 2: Verify generated structure**

```bash
find src/api/v1/workspace-plan -type f | sort
```

Expected output:

```
src/api/v1/workspace-plan/admin/dto/workspace-plan.admin.dto.ts
src/api/v1/workspace-plan/admin/workspace-plan.admin.controller.spec.ts
src/api/v1/workspace-plan/admin/workspace-plan.admin.controller.ts
src/api/v1/workspace-plan/admin/workspace-plan.admin.service.spec.ts
src/api/v1/workspace-plan/admin/workspace-plan.admin.service.ts
src/api/v1/workspace-plan/authorized/dto/workspace-plan.authorized.dto.ts
src/api/v1/workspace-plan/authorized/workspace-plan.authorized.controller.spec.ts
src/api/v1/workspace-plan/authorized/workspace-plan.authorized.controller.ts
src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.spec.ts
src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.ts
src/api/v1/workspace-plan/public/dto/workspace-plan.public.dto.ts
src/api/v1/workspace-plan/public/workspace-plan.public.controller.spec.ts
src/api/v1/workspace-plan/public/workspace-plan.public.controller.ts
src/api/v1/workspace-plan/public/workspace-plan.public.service.spec.ts
src/api/v1/workspace-plan/public/workspace-plan.public.service.ts
src/api/v1/workspace-plan/workspace-plan.module.ts
```

- [ ] **Step 3: Commit scaffold**

```bash
cd .. && git add apps/backend/src/api/v1/workspace-plan/
git commit -m "feat(backend): scaffold workspace-plan NestJS module"
```

---

## Task 3: WorkspacePlan DTO File

**Files:**

- Modify: `apps/backend/src/api/v1/workspace-plan/authorized/dto/workspace-plan.authorized.dto.ts`

- [ ] **Step 1: Replace generated content with Zod schemas**

Replace the entire file content with:

```ts
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const WorkspacePlanStatusEnum = z.enum([
  'normal',
  'warning',
  'alarm',
  'offline',
])

export const CreateWorkspacePlanSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
})

export const UpdateWorkspacePlanSchema = CreateWorkspacePlanSchema.omit({
  workspaceId: true,
}).partial()

export const WorkspacePlanQuerySchema = z.object({
  workspaceId: z.string().uuid(),
})

export const DeleteWorkspacePlanSchema = z.object({
  planId: z.string().uuid(),
})

export class CreateWorkspacePlanDto extends createZodDto(
  CreateWorkspacePlanSchema,
) {}
export class UpdateWorkspacePlanDto extends createZodDto(
  UpdateWorkspacePlanSchema,
) {}
export class WorkspacePlanQueryDto extends createZodDto(
  WorkspacePlanQuerySchema,
) {}
export class DeleteWorkspacePlanDto extends createZodDto(
  DeleteWorkspacePlanSchema,
) {}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter backend check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/api/v1/workspace-plan/authorized/dto/workspace-plan.authorized.dto.ts
git commit -m "feat(backend): add workspace-plan authorized DTOs with Zod schemas"
```

---

## Task 4: WorkspacePlan Service

**Files:**

- Modify: `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.ts`
- Modify: `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.spec.ts`

- [ ] **Step 1: Write the failing service spec**

Replace `workspace-plan.authorized.service.spec.ts` content with:

```ts
import { Test, TestingModule } from '@nestjs/testing'
import { WorkspacePlanAuthorizedService } from './workspace-plan.authorized.service'
import { PrismaService } from '@softsensor/prisma'

const mockPrisma = {
  workspacePlan: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workspace: {
    findUnique: jest.fn(),
  },
  workspaceMember: {
    findUnique: jest.fn(),
  },
}

describe('WorkspacePlanAuthorizedService', () => {
  let service: WorkspacePlanAuthorizedService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacePlanAuthorizedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get<WorkspacePlanAuthorizedService>(
      WorkspacePlanAuthorizedService,
    )
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('getPlans', () => {
    it('aggregates nodeCount and alarmCount from nodes', async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ ownerId: 'u1' })
      mockPrisma.workspacePlan.findMany.mockResolvedValue([
        {
          id: 'p1',
          workspaceId: 'ws1',
          name: 'Floor 1',
          icon: null,
          color: 'blue',
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          nodes: [
            { data: { status: 'alarm' } },
            { data: { status: 'normal' } },
          ],
        },
      ])

      const result = await service.getPlans('ws1', 'u1')

      expect(result.data[0].nodeCount).toBe(2)
      expect(result.data[0].alarmCount).toBe(1)
      expect(result.data[0].status).toBe('alarm')
    })
  })

  describe('createPlan', () => {
    it('throws 403 when user has no access', async () => {
      mockPrisma.workspace.findUnique.mockResolvedValue({ ownerId: 'other' })
      mockPrisma.workspaceMember.findUnique.mockResolvedValue(null)

      await expect(
        service.createPlan({ workspaceId: 'ws1', name: 'Zone A' }, 'u1'),
      ).rejects.toMatchObject({ status: 403 })
    })
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace-plan.authorized.service
```

Expected: FAIL — `WorkspacePlanAuthorizedService` not yet implemented.

- [ ] **Step 3: Implement the service**

Replace `workspace-plan.authorized.service.ts` content with:

```ts
import { Injectable } from '@nestjs/common'
import { AppException } from '@softsensor/common'
import { PrismaService } from '@softsensor/prisma'
import type {
  CreateWorkspacePlanDto,
  UpdateWorkspacePlanDto,
} from './dto/workspace-plan.authorized.dto'

type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

@Injectable()
export class WorkspacePlanAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCanEdit(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    })

    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }

    if (workspace.ownerId === userId) return

    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })

    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Editor access required',
        type: 'ERROR',
      })
    }
  }

  private deriveStatus(nodes: { data: unknown }[]): {
    nodeCount: number
    alarmCount: number
    status: NodeStatus
  } {
    const priority: Record<string, number> = {
      alarm: 3,
      offline: 2,
      warning: 1,
      normal: 0,
    }
    const statusMap: Record<number, NodeStatus> = {
      0: 'normal',
      1: 'warning',
      2: 'offline',
      3: 'alarm',
    }
    let worst = 0
    let alarmCount = 0
    for (const node of nodes) {
      const data = node.data as Record<string, unknown>
      const st = typeof data?.status === 'string' ? data.status : 'normal'
      if (st !== 'normal') alarmCount++
      const p = priority[st] ?? 0
      if (p > worst) worst = p
    }
    return {
      nodeCount: nodes.length,
      alarmCount,
      status: statusMap[worst] ?? 'normal',
    }
  }

  async getPlans(workspaceId: string, userId: string) {
    await this.assertCanEdit(workspaceId, userId)

    const plans = await this.prisma.workspacePlan.findMany({
      where: { workspaceId },
      include: { nodes: { select: { data: true } } },
      orderBy: { createdAt: 'asc' },
    })

    const data = plans.map(({ nodes, ...plan }) => ({
      ...plan,
      ...this.deriveStatus(nodes),
    }))

    return {
      statusCode: 200,
      message: 'Plans fetched successfully',
      type: 'SUCCESS' as const,
      data,
    }
  }

  async createPlan(dto: CreateWorkspacePlanDto, userId: string) {
    await this.assertCanEdit(dto.workspaceId, userId)

    const plan = await this.prisma.workspacePlan.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        description: dto.description,
      },
    })

    return {
      statusCode: 201,
      message: 'Plan created successfully',
      type: 'SUCCESS' as const,
      data: {
        ...plan,
        nodeCount: 0,
        alarmCount: 0,
        status: 'normal' as NodeStatus,
      },
    }
  }

  async updatePlan(
    planId: string,
    dto: UpdateWorkspacePlanDto,
    userId: string,
  ) {
    const existing = await this.prisma.workspacePlan.findUnique({
      where: { id: planId },
    })

    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Plan not found',
        type: 'ERROR',
      })
    }

    await this.assertCanEdit(existing.workspaceId, userId)

    const updated = await this.prisma.workspacePlan.update({
      where: { id: planId },
      data: {
        name: dto.name,
        icon: dto.icon,
        color: dto.color,
        description: dto.description,
      },
      include: { nodes: { select: { data: true } } },
    })

    const { nodes, ...plan } = updated

    return {
      statusCode: 200,
      message: 'Plan updated successfully',
      type: 'SUCCESS' as const,
      data: { ...plan, ...this.deriveStatus(nodes) },
    }
  }

  async deletePlan(planId: string, userId: string) {
    const existing = await this.prisma.workspacePlan.findUnique({
      where: { id: planId },
    })

    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Plan not found',
        type: 'ERROR',
      })
    }

    await this.assertCanEdit(existing.workspaceId, userId)
    await this.prisma.workspacePlan.delete({ where: { id: planId } })

    return {
      statusCode: 200,
      message: 'Plan deleted successfully',
      type: 'SUCCESS' as const,
      data: null,
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter backend test -- --testPathPatterns=workspace-plan.authorized.service
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.ts \
        apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.service.spec.ts
git commit -m "feat(backend): implement WorkspacePlanAuthorizedService with CRUD + status aggregation"
```

---

## Task 5: WorkspacePlan Controller

**Files:**

- Modify: `apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.controller.ts`

- [ ] **Step 1: Replace generated controller**

Replace `workspace-plan.authorized.controller.ts` content with:

```ts
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAccessGuard } from '@/guards/jwt-access.guard'
import { Users } from '@/common/decorators/user.decorator'
import { WorkspacePlanAuthorizedService } from './workspace-plan.authorized.service'
import {
  CreateWorkspacePlanDto,
  UpdateWorkspacePlanDto,
  WorkspacePlanQueryDto,
  DeleteWorkspacePlanDto,
} from './dto/workspace-plan.authorized.dto'

@ApiBearerAuth()
@ApiTags('Authorized WorkspacePlan')
@Controller('authorized/workspace-plan')
@UseGuards(JwtAccessGuard)
export class WorkspacePlanAuthorizedController {
  constructor(
    private readonly workspacePlanService: WorkspacePlanAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all plans for a workspace' })
  async getPlans(
    @Query() query: WorkspacePlanQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanService.getPlans(query.workspaceId, user.id)
  }

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new plan in a workspace' })
  async createPlan(
    @Body() dto: CreateWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanService.createPlan(dto, user.id)
  }

  @Patch('/:planId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a plan by ID' })
  async updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdateWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanService.updatePlan(planId, dto, user.id)
  }

  @Delete('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a plan by ID' })
  async deletePlan(
    @Body() dto: DeleteWorkspacePlanDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlanService.deletePlan(dto.planId, user.id)
  }
}
```

- [ ] **Step 2: Wire controller + service into workspace-plan.module.ts**

Replace `workspace-plan.module.ts` content with:

```ts
import { Module } from '@nestjs/common'
import { WorkspacePlanAuthorizedController } from './authorized/workspace-plan.authorized.controller'
import { WorkspacePlanAuthorizedService } from './authorized/workspace-plan.authorized.service'

@Module({
  controllers: [WorkspacePlanAuthorizedController],
  providers: [WorkspacePlanAuthorizedService],
})
export class WorkspacePlanModule {}
```

- [ ] **Step 3: Register WorkspacePlanModule in AppModule**

In `apps/backend/src/app.module.ts`, add the import:

```ts
import { WorkspacePlanModule } from './api/v1/workspace-plan/workspace-plan.module'
```

And add `WorkspacePlanModule` to the `imports` array (after `NodesModule`):

```ts
NodesModule,
WorkspacePlanModule,
```

- [ ] **Step 4: Type-check and build**

```bash
pnpm --filter backend check-types
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/v1/workspace-plan/workspace-plan.module.ts \
        apps/backend/src/api/v1/workspace-plan/authorized/workspace-plan.authorized.controller.ts \
        apps/backend/src/app.module.ts
git commit -m "feat(backend): register WorkspacePlanModule with controller wired to service"
```

---

## Task 6: Update Nodes Module — Add planId

**Files:**

- Modify: `apps/backend/src/api/v1/nodes/authorized/dto/nodes.authorized.dto.ts`
- Modify: `apps/backend/src/api/v1/nodes/authorized/nodes.authorized.service.ts`
- Modify: `apps/backend/src/api/v1/nodes/authorized/nodes.authorized.controller.ts`

- [ ] **Step 1: Add planId to Nodes DTOs**

In `nodes.authorized.dto.ts`, update `CreateNodeSchema` and `NodeQuerySchema`:

```ts
export const CreateNodeSchema = z.object({
  workspaceId: z.string().uuid(),
  planId: z.string().uuid(),
  data: NodeDataSchema,
})

export const NodeQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  planId: z.string().uuid().optional(),
})
```

(Keep `UpdateNodeSchema` and `DeleteNodeSchema` unchanged.)

- [ ] **Step 2: Update service — listByWorkspace accepts planId filter**

In `nodes.authorized.service.ts`, update `listByWorkspace` signature and Prisma query:

```ts
async listByWorkspace(workspaceId: string, userId: string, planId?: string) {
  await this.assertHasAccess(workspaceId, userId);

  const nodes = await this.prisma.nodes.findMany({
    where: { workspaceId, ...(planId ? { planId } : {}) },
    include: { models: true },
    orderBy: { createdAt: 'asc' },
  });

  return {
    statusCode: 200,
    message: 'Nodes fetched successfully',
    type: 'SUCCESS' as const,
    data: nodes,
  };
}
```

Update `createNodeService` to accept and store `planId`:

```ts
async createNodeService(
  workspaceId: string,
  planId: string,
  userId: string,
  data: z.infer<typeof NodeDataSchema>,
) {
  await this.assertCanEditCanvas(workspaceId, userId);

  const node = await this.prisma.nodes.create({
    data: { workspaceId, planId, data },
    include: { models: true },
  });

  return {
    statusCode: 201,
    message: 'Node created successfully',
    type: 'SUCCESS' as const,
    data: node,
  };
}
```

- [ ] **Step 3: Update controller to pass planId**

In `nodes.authorized.controller.ts`, update `listByWorkspace` and `createNodeController`:

```ts
@Get('/')
async listByWorkspace(
  @Query() query: NodeQueryDto,
  @Users() user: Auth.UserPayload,
) {
  return this.nodesAuthorizedService.listByWorkspace(
    query.workspaceId,
    user.id,
    query.planId,
  );
}

@Post('/')
async createNodeController(
  @Body() dto: CreateNodeDto,
  @Users() user: Auth.UserPayload,
) {
  return this.nodesAuthorizedService.createNodeService(
    dto.workspaceId,
    dto.planId,
    user.id,
    dto.data,
  );
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter backend check-types
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/v1/nodes/authorized/
git commit -m "feat(backend): add planId to Nodes create/query — required FK to WorkspacePlan"
```

---

## Task 7: Full Backend Build + Tests

- [ ] **Step 1: Run all backend tests**

```bash
pnpm --filter backend test
```

Expected: all tests pass.

- [ ] **Step 2: Full build**

```bash
pnpm build
```

Expected: no compilation errors.

---

## Task 8: Frontend Types

**Files:**

- Modify: `apps/client/types/index.ts`

- [ ] **Step 1: Add WorkspacePlan interface**

Add after the `Workspace` interface in `apps/client/types/index.ts`:

```ts
export interface WorkspacePlan {
  id: string
  workspaceId: string
  name: string
  icon?: string
  color?: string
  description?: string
  nodeCount?: number
  alarmCount?: number
  status?: 'normal' | 'warning' | 'alarm' | 'offline'
  createdAt: string
  updatedAt: string
}
```

Also add `plans?: WorkspacePlan[]` to the `Workspace` interface (after `status?`):

```ts
plans?: WorkspacePlan[]
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/types/index.ts
git commit -m "feat(client): add WorkspacePlan type and plans field to Workspace"
```

---

## Task 9: Frontend Services

**Files:**

- Modify: `apps/client/services/canvas.ts`
- Create: `apps/client/services/workspace-plan.ts`

- [ ] **Step 1: Add planId to CanvasNode and update createNode**

In `apps/client/services/canvas.ts`:

1. Add `planId: string` to the `CanvasNode` interface (after `workspaceId`):

```ts
export interface CanvasNode {
  id: string
  workspaceId: string
  planId: string
  data: NodeData
  models: CanvasModel[]
  createdAt: string
  updatedAt: string
}
```

2. Update `getNodes` to accept optional `planId`:

```ts
export async function getNodes(
  workspaceId: string,
  planId?: string,
): Promise<CanvasNode[]> {
  const params = new URLSearchParams({ workspaceId })
  if (planId) params.set('planId', planId)
  const res: { data: CanvasNode[] } = await fetchClient(
    `/api/v1/authorized/nodes?${params.toString()}`,
    { method: 'GET' },
  )
  return res.data
}
```

3. Update `createNode` to include `planId`:

```ts
export async function createNode(
  workspaceId: string,
  planId: string,
  data: NodeData,
): Promise<CanvasNode> {
  const res: { data: CanvasNode } = await fetchClient(
    '/api/v1/authorized/nodes',
    {
      method: 'POST',
      body: JSON.stringify({ workspaceId, planId, data }),
    },
  )
  return res.data
}
```

- [ ] **Step 2: Create workspace-plan service**

Create `apps/client/services/workspace-plan.ts`:

```ts
import { fetchClient } from '@/lib/fetcher'
import type { WorkspacePlan } from '@/types'

export async function getWorkspacePlans(
  workspaceId: string,
): Promise<WorkspacePlan[]> {
  const res: { data: WorkspacePlan[] } = await fetchClient(
    `/api/v1/authorized/workspace-plan?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'GET' },
  )
  return res.data
}

export async function createWorkspacePlan(dto: {
  workspaceId: string
  name: string
  icon?: string
  color?: string
  description?: string
}): Promise<WorkspacePlan> {
  const res: { data: WorkspacePlan } = await fetchClient(
    '/api/v1/authorized/workspace-plan',
    { method: 'POST', body: JSON.stringify(dto) },
  )
  return res.data
}

export async function updateWorkspacePlan(
  planId: string,
  dto: { name?: string; icon?: string; color?: string; description?: string },
): Promise<WorkspacePlan> {
  const res: { data: WorkspacePlan } = await fetchClient(
    `/api/v1/authorized/workspace-plan/${planId}`,
    { method: 'PATCH', body: JSON.stringify(dto) },
  )
  return res.data
}

export async function deleteWorkspacePlan(planId: string): Promise<void> {
  await fetchClient('/api/v1/authorized/workspace-plan', {
    method: 'DELETE',
    body: JSON.stringify({ planId }),
  })
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter client check-types
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/services/canvas.ts apps/client/services/workspace-plan.ts
git commit -m "feat(client): add planId to CanvasNode, update canvas service, add workspace-plan service"
```

---

## Task 10: Frontend State — Jotai Atom

**Files:**

- Modify: `apps/client/store/workspace.ts`

- [ ] **Step 1: Add workspacePlansAtom**

In `apps/client/store/workspace.ts`, add after the `workspacesAtom` line:

```ts
import type { WorkspacePlan } from '@/types'

export const workspacePlansAtom = atomWithStorage<WorkspacePlan[]>(
  'workspace-plans',
  [],
)
```

(The `atomWithStorage` import is already present.)

- [ ] **Step 2: Commit**

```bash
git add apps/client/store/workspace.ts
git commit -m "feat(client): add workspacePlansAtom to Jotai store"
```

---

## Task 11: Frontend Hook — useWorkspacePlans

**Files:**

- Create: `apps/client/hooks/workspace/use-workspace-plans.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/client/hooks/workspace/__tests__/use-workspace-plans.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWorkspacePlans } from '../use-workspace-plans'

vi.mock('@/services/workspace-plan', () => ({
  getWorkspacePlans: vi.fn(),
}))

import { getWorkspacePlans } from '@/services/workspace-plan'

describe('useWorkspacePlans', () => {
  beforeEach(() => {
    vi.mocked(getWorkspacePlans).mockResolvedValue([])
  })

  it('fetches plans for given workspaceId', async () => {
    renderHook(() => useWorkspacePlans('ws1'))
    await waitFor(() => {
      expect(getWorkspacePlans).toHaveBeenCalledWith('ws1')
    })
  })

  it('returns plans from service', async () => {
    vi.mocked(getWorkspacePlans).mockResolvedValue([
      {
        id: 'p1',
        workspaceId: 'ws1',
        name: 'Floor 1',
        nodeCount: 3,
        alarmCount: 1,
        status: 'alarm',
        createdAt: '',
        updatedAt: '',
      },
    ])
    const { result } = renderHook(() => useWorkspacePlans('ws1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.plans).toHaveLength(1)
    expect(result.current.plans[0].status).toBe('alarm')
  })

  it('does not fetch when workspaceId is null', async () => {
    renderHook(() => useWorkspacePlans(null))
    await waitFor(() => {})
    expect(getWorkspacePlans).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter client test -- use-workspace-plans
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `apps/client/hooks/workspace/use-workspace-plans.ts`:

```ts
'use client'
import { useState, useEffect, useCallback } from 'react'
import { getWorkspacePlans } from '@/services/workspace-plan'
import type { WorkspacePlan } from '@/types'

interface UseWorkspacePlansResult {
  plans: WorkspacePlan[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useWorkspacePlans(
  workspaceId: string | null,
): UseWorkspacePlansResult {
  const [plans, setPlans] = useState<WorkspacePlan[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)

    getWorkspacePlans(workspaceId)
      .then(data => {
        if (!cancelled) {
          setPlans(data)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load plans')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    return fetch()
  }, [fetch])

  return { plans, loading, error, refetch: fetch }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter client test -- use-workspace-plans
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/client/hooks/workspace/use-workspace-plans.ts \
        apps/client/hooks/workspace/__tests__/use-workspace-plans.test.ts
git commit -m "feat(client): add useWorkspacePlans hook with tests"
```

---

## Task 12: Generalize isomatric.ts to ZoneItem

**Files:**

- Modify: `apps/client/lib/isomatric.ts`

The current `calculateIsometricLayout` takes `Workspace[]` and the `ZoneLayoutData.ws` field is typed as `Workspace`. We generalize to a `ZoneItem` interface so both `Workspace` and `WorkspacePlan` can be passed.

- [ ] **Step 1: Update isomatric.ts**

Replace the entire file with:

```ts
import type { CanvasNode } from '@/services/canvas'

export const GRID_SPACING = 80
export const MIN_ZONE_SIZE = 150
export const ZONE_MARGIN = 80
export const ZONES_PER_ROW = 2

export interface ZoneItem {
  id: string
  name: string
  color?: string
}

export interface MappedNode {
  node: CanvasNode
  isoX: number
  isoY: number
}

export interface ZoneLayoutData {
  zone: ZoneItem
  zoneWidth: number
  zoneHeight: number
  mappedNodes: MappedNode[]
  floorPath: string
  labelX: number
  labelY: number
}

export function getZoneFloorPath(
  startX: number,
  startY: number,
  width: number,
  height: number,
  CX: number,
  CY: number,
): string {
  const corners: [number, number][] = [
    [startX, startY],
    [startX + width, startY],
    [startX + width, startY + height],
    [startX, startY + height],
  ]
  const pts = corners.map(([x, y]) => {
    const isoX = (x - y) * Math.cos(Math.PI / 6) + CX
    const isoY = (x + y) * Math.sin(Math.PI / 6) * 0.5 + CY
    return `${isoX},${isoY}`
  })
  return `M ${pts[0]} L ${pts[1]} L ${pts[2]} L ${pts[3]} Z`
}

export function calculateIsometricLayout(
  zones: ZoneItem[],
  nodesByZone: Map<string, CanvasNode[]>,
  CX: number,
  CY: number,
): ZoneLayoutData[] {
  let currentX = 0
  let currentY = 0
  let rowMaxHeight = 0

  return zones.map((zone, index) => {
    const zoneNodes = nodesByZone.get(zone.id) ?? []
    const nodeCount = zoneNodes.length

    let zoneWidth = MIN_ZONE_SIZE
    let zoneHeight = MIN_ZONE_SIZE
    let mappedNodes: MappedNode[] = []

    if (nodeCount > 0) {
      const cols = Math.max(2, Math.ceil(Math.sqrt(nodeCount)))
      const rows = Math.ceil(nodeCount / cols)

      zoneWidth = Math.max(MIN_ZONE_SIZE, cols * GRID_SPACING + 40)
      zoneHeight = Math.max(MIN_ZONE_SIZE, rows * GRID_SPACING + 40)

      mappedNodes = zoneNodes.map((node, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)

        const localX = currentX + col * GRID_SPACING + GRID_SPACING / 2 + 20
        const localY = currentY + row * GRID_SPACING + GRID_SPACING / 2 + 20

        const isoX = (localX - localY) * Math.cos(Math.PI / 6) + CX
        const isoY = (localX + localY) * Math.sin(Math.PI / 6) * 0.5 + CY

        return { node, isoX, isoY }
      })
    }

    const floorPath = getZoneFloorPath(
      currentX,
      currentY,
      zoneWidth,
      zoneHeight,
      CX,
      CY,
    )

    const center2DX = currentX + zoneWidth / 2
    const center2DY = currentY + zoneHeight / 2
    const labelX = (center2DX - center2DY) * Math.cos(Math.PI / 6) + CX
    const labelY = (center2DX + center2DY) * Math.sin(Math.PI / 6) * 0.5 + CY

    const layoutData: ZoneLayoutData = {
      zone,
      zoneWidth,
      zoneHeight,
      mappedNodes,
      floorPath,
      labelX,
      labelY,
    }

    rowMaxHeight = Math.max(rowMaxHeight, zoneHeight)
    currentX += zoneWidth + ZONE_MARGIN

    if ((index + 1) % ZONES_PER_ROW === 0) {
      currentX = 0
      currentY += rowMaxHeight + ZONE_MARGIN
      rowMaxHeight = 0
    }

    return layoutData
  })
}
```

- [ ] **Step 2: Fix isometric-map.tsx references**

`isometric-map.tsx` currently uses `ws` for the zone data and accesses `ws.id`, `ws.color`, `ws.name`. All occurrences of `ws` in the layout iteration must change to `zone`. Also update the import to use `ZoneItem` instead of `Workspace`.

In `apps/client/app/(default)/dashboard/components/isometric-map.tsx`:

1. Remove the `import type { Workspace } from '@/types'` line.
2. Add: `import type { ZoneItem } from '@/lib/isomatric'`
3. In `IsometricMapProps`, change `workspaces: Workspace[]` → `zones: ZoneItem[]`
4. In the `useMemo` for `layoutData`:
   - Change param name `workspaces` → `zones`
   - Change `nodesByWorkspace` → `nodesByZone`
   - Update the Map population loop: `map.get(node.workspaceId)` → `map.get(node.planId ?? node.workspaceId)` (nodes in plan mode have `planId`; in workspace mode they have `workspaceId`)
5. In the render loop, change `{ ws, mappedNodes, floorPath, labelX, labelY }` → `{ zone, mappedNodes, floorPath, labelX, labelY }`
6. Replace all `ws.` → `zone.` in the render body (id, color, name).
7. In props `selectedWorkspaceId` → `selectedZoneId`, `onWorkspaceSelect` → `onZoneSelect`.

Full updated `isometric-map.tsx`:

```tsx
'use client'

import { useMemo, useState, useRef } from 'react'
import { MachineNode } from './machine-node'
import { calculateIsometricLayout } from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import type { CanvasNode } from '@/services/canvas'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

interface IsometricMapProps {
  zones: ZoneItem[]
  nodes: CanvasNode[]
  selectedZoneId: string | null
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
  onZoneSelect?: (zoneId: string) => void
  zoneNodeKey?: 'planId' | 'workspaceId'
}

export function IsometricMap({
  zones,
  nodes,
  selectedZoneId,
  selectedNodeId,
  onNodeClick,
  onZoneSelect,
  zoneNodeKey = 'planId',
}: IsometricMapProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  const layoutData = useMemo(() => {
    const map = new Map<string, CanvasNode[]>()
    for (const node of nodes) {
      const key = zoneNodeKey === 'planId' ? node.planId : node.workspaceId
      const arr = map.get(key) ?? []
      arr.push(node)
      map.set(key, arr)
    }
    return calculateIsometricLayout(zones, map, CX, CY)
  }, [zones, nodes, zoneNodeKey])

  return (
    <TooltipProvider>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          background:
            'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y})`}>
          {layoutData.map(
            ({ zone, mappedNodes, floorPath, labelX, labelY }) => {
              const accentHex = COLOR_HEX[zone.color ?? 'blue'] ?? '#3b82f6'
              const isSelected = selectedZoneId === zone.id
              const isHovered = hoveredZoneId === zone.id
              const strokeColor =
                isSelected || isHovered ? accentHex : '#1e2230'

              const alarmCount = mappedNodes.filter(
                m => m.node.data.status === 'alarm',
              ).length
              const warningCount = mappedNodes.filter(
                m => m.node.data.status === 'warning',
              ).length

              let zoneStatusText = 'NORMAL'
              let zoneStatusColor = '#10b981'

              if (alarmCount > 0) {
                zoneStatusText = `${alarmCount} ALARM`
                zoneStatusColor = '#ef4444'
              } else if (warningCount > 0) {
                zoneStatusText = `${warningCount} WARNING`
                zoneStatusColor = '#f59e0b'
              }

              return (
                <g key={zone.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <g
                        className="cursor-pointer transition-all duration-300"
                        onMouseEnter={() =>
                          !isDragging && setHoveredZoneId(zone.id)
                        }
                        onMouseLeave={() => setHoveredZoneId(null)}
                        onClick={() => !isDragging && onZoneSelect?.(zone.id)}
                      >
                        <path
                          d={floorPath}
                          fill={
                            isSelected
                              ? `${accentHex}20`
                              : isHovered
                                ? `${accentHex}10`
                                : 'rgba(14,20,35,0.6)'
                          }
                          stroke={strokeColor}
                          strokeWidth={isSelected || isHovered ? 2 : 1}
                          strokeDasharray={isSelected ? '0' : '8,5'}
                        />
                      </g>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="border-border bg-card text-foreground"
                    >
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="font-semibold text-primary">
                          {zone.name} Zone
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {mappedNodes.length} Devices
                        </span>
                        {alarmCount > 0 && (
                          <span className="text-xs font-medium text-red-500">
                            {alarmCount} Devices in Alarm
                          </span>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  {mappedNodes.map(({ node, isoX, isoY }) => (
                    <MachineNode
                      key={node.id}
                      type={node.data.type}
                      icon={node.data.icon}
                      status={node.data.status}
                      label={node.data.name}
                      isoX={isoX}
                      isoY={isoY}
                      selected={selectedNodeId === node.id}
                      onClick={() => !isDragging && onNodeClick(node.id)}
                    />
                  ))}

                  <g style={{ pointerEvents: 'none' }}>
                    <text
                      x={labelX}
                      y={labelY - 100}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={800}
                      fill={isSelected || isHovered ? accentHex : '#ffffff'}
                      stroke="#0e1520"
                      strokeWidth="4"
                      paintOrder="stroke fill"
                      letterSpacing={3}
                      fontFamily="monospace"
                    >
                      {zone.name.toUpperCase()}
                    </text>

                    <g transform={`translate(${labelX}, ${labelY + 5})`}>
                      <rect
                        x="-35"
                        y="-100"
                        width="70"
                        height="16"
                        rx="8"
                        fill={`${zoneStatusColor}20`}
                        stroke={zoneStatusColor}
                        strokeWidth="1"
                      />
                      <circle cx="-25" cy="-92" r="3" fill={zoneStatusColor} />
                      <text
                        x="3"
                        y="-89"
                        textAnchor="middle"
                        fontSize={8}
                        fontWeight="bold"
                        fill={zoneStatusColor}
                      >
                        {zoneStatusText}
                      </text>
                    </g>
                  </g>
                </g>
              )
            },
          )}
        </g>
      </svg>
    </TooltipProvider>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter client check-types
```

Expected: no errors. If there are errors in files that import `IsometricMap` with the old `workspaces` prop, fix them in the next task.

- [ ] **Step 4: Commit**

```bash
git add apps/client/lib/isomatric.ts \
        apps/client/app/(default)/dashboard/components/isometric-map.tsx
git commit -m "refactor(client): generalize isomatric.ts to ZoneItem, update IsometricMap props"
```

---

## Task 13: Dashboard Page — viewMode + Plan Drill-down

**Files:**

- Modify: `apps/client/app/(default)/dashboard/page.tsx`
- Modify: `apps/client/hooks/use-dashboard-data.ts`
- Modify: `apps/client/app/(default)/dashboard/components/node-detail-panel.tsx`

- [ ] **Step 1: Update use-dashboard-data.ts to expose workspaceId**

The hook currently reads all workspaces from the atom and fetches nodes for all. Update it to expose `workspaceId` selection and accept an optional `planId` filter so the dashboard page can fetch plan-filtered nodes:

Replace `apps/client/hooks/use-dashboard-data.ts` with:

```ts
'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useState, useCallback } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface DashboardData {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  loading: boolean
  error: string | null
  refetchNodes: (workspaceId?: string, planId?: string) => void
}

export function useDashboardData(): DashboardData {
  const workspaces = useAtomValue(workspacesAtom)
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNodes = useCallback(
    (workspaceId?: string, planId?: string) => {
      if (workspaces.length === 0) {
        setLoading(false)
        return
      }

      let cancelled = false
      setLoading(true)

      const targets = workspaceId
        ? workspaces.filter(w => w.id === workspaceId)
        : workspaces

      Promise.all(targets.map(ws => getNodes(ws.id, planId)))
        .then(results => {
          if (cancelled) return
          setNodes(results.flat())
          setError(null)
        })
        .catch(() => {
          if (cancelled) return
          setError('Failed to load device data')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })

      return () => {
        cancelled = true
      }
    },
    [workspaces],
  )

  useEffect(() => {
    return fetchNodes()
  }, [fetchNodes])

  return { workspaces, nodes, loading, error, refetchNodes: fetchNodes }
}
```

- [ ] **Step 2: Update NodeDetailPanel to handle plan context**

Replace `apps/client/app/(default)/dashboard/components/node-detail-panel.tsx` with:

```tsx
'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Settings2 } from 'lucide-react'
import type { CanvasNode } from '@/services/canvas'
import type { WorkspacePlan } from '@/types'
import type { NodeStatus } from '../../../../store/status-colors'

const STATUS_CHIP: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  alarm: 'bg-red-500/15 text-red-400 border border-red-500/30',
  offline: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30',
}

interface NodeDetailPanelProps {
  node: CanvasNode | null
  plan: WorkspacePlan | null
  workspaceId: string | null
  viewMode: 'plans' | 'equipment'
  onDrillDown?: (planId: string) => void
  onEditClick?: (node: CanvasNode) => void
}

export function NodeDetailPanel({
  node,
  plan,
  workspaceId,
  viewMode,
  onDrillDown,
  onEditClick,
}: NodeDetailPanelProps) {
  // Plan selected (before drill-down)
  if (viewMode === 'plans' && plan) {
    const planStatus = (plan.status ?? 'normal') as NodeStatus
    return (
      <aside className="flex w-50 shrink-0 flex-col border-l border-border bg-[#0a0d14]">
        <div className="border-b border-border bg-[#0d1018] px-3.5 py-3">
          <div className="mb-0.5 text-[9px] text-muted-foreground/50">
            WORKSPACE PLAN
          </div>
          <div className="mb-2 text-sm font-bold text-foreground">
            {plan.name}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
              STATUS_CHIP[planStatus],
            )}
          >
            {planStatus}
          </span>
        </div>

        <div className="border-b border-border/50 px-3.5 py-2.5">
          <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Equipment Summary
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Total devices</span>
            <span className="font-semibold text-foreground">
              {plan.nodeCount ?? 0}
            </span>
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>Non-normal</span>
            <span
              className={cn(
                'font-semibold',
                (plan.alarmCount ?? 0) > 0
                  ? 'text-red-400'
                  : 'text-emerald-400',
              )}
            >
              {plan.alarmCount ?? 0}
            </span>
          </div>
        </div>

        <div className="mt-auto px-3.5 py-3">
          <button
            onClick={() => onDrillDown?.(plan.id)}
            className="block w-full rounded-md bg-primary py-2 text-center text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View Equipment →
          </button>
        </div>
      </aside>
    )
  }

  // Equipment selected (after drill-down)
  if (viewMode === 'equipment' && node) {
    const status = node.data.status as NodeStatus
    return (
      <aside className="flex w-50 shrink-0 flex-col border-l border-border bg-[#0a0d14]">
        <div className="border-b border-border bg-[#0d1018] px-3.5 py-3">
          <div className="flex items-start justify-between">
            <div className="mb-0.5 text-[9px] text-muted-foreground/50">
              {node.data.type}
            </div>
            {onEditClick && (
              <button
                onClick={() => onEditClick(node)}
                className="text-muted-foreground/50 transition-colors hover:text-foreground"
                title="Edit Device Settings"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mb-2 text-sm font-bold text-foreground">
            {node.data.name}
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
              STATUS_CHIP[status],
            )}
          >
            {status}
          </span>
        </div>

        <div className="border-b border-border/50 px-3.5 py-2.5">
          <div className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            AI Models
          </div>
          {node.models.length === 0 ? (
            <p className="text-[9px] text-muted-foreground/30">
              No models assigned
            </p>
          ) : (
            node.models.map(model => (
              <div key={model.id} className="flex items-center gap-1.5 py-1">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="flex-1 truncate text-[9px] text-muted-foreground">
                  {model.name}
                </span>
                <span className="text-[8px] text-emerald-400">active</span>
              </div>
            ))
          )}
        </div>

        <div className="border-b border-border/50 px-3.5 py-2.5">
          <div className="mb-1 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
            Last Updated
          </div>
          <div className="text-[9px] text-muted-foreground">
            {new Date(node.updatedAt).toLocaleString()}
          </div>
        </div>

        <div className="mt-auto px-3.5 py-3">
          {workspaceId && (
            <Link
              href={`/workspaces/${workspaceId}/canvas`}
              className="mb-1.5 block rounded-md bg-primary py-2 text-center text-[10px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              View Details →
            </Link>
          )}
          <button
            className="block w-full rounded-md border border-border bg-muted/20 py-1.5 text-center text-[9px] text-muted-foreground transition-colors hover:text-foreground"
            disabled={status === 'normal' || status === 'offline'}
          >
            Acknowledge Alarm
          </button>
        </div>
      </aside>
    )
  }

  // Nothing selected — context-aware empty state
  return (
    <aside className="flex w-50 shrink-0 flex-col items-center justify-center border-l border-border bg-[#0a0d14] text-center">
      <p className="text-[11px] text-muted-foreground/40">
        {viewMode === 'plans'
          ? 'Select a plan on the map'
          : 'Select a device on the map'}
      </p>
    </aside>
  )
}
```

- [ ] **Step 3: Rewrite dashboard page.tsx**

Replace `apps/client/app/(default)/dashboard/page.tsx` with:

```tsx
'use client'
import { useState, useMemo, useEffect } from 'react'
import { IsometricMap } from './components/isometric-map'
import { NodeDetailPanel } from './components/node-detail-panel'
import { MachineLegend } from './components/machine-legend'
import { useDashboardData } from '../../../hooks/use-dashboard-data'
import { useWorkspacePlans } from '../../../hooks/workspace/use-workspace-plans'
import type { NodeStatus } from '../../../store/status-colors'

export default function DashboardPage() {
  const { workspaces, nodes, loading, error, refetchNodes } = useDashboardData()
  const [viewMode, setViewMode] = useState<'plans' | 'equipment'>('plans')
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<NodeStatus | null>(null)

  // Use first workspace for now; can be extended to workspace switcher
  const activeWorkspaceId = workspaces[0]?.id ?? null

  const { plans, loading: plansLoading } = useWorkspacePlans(activeWorkspaceId)

  // When drilling into a plan, fetch nodes filtered by planId
  useEffect(() => {
    if (viewMode === 'equipment' && selectedPlanId && activeWorkspaceId) {
      refetchNodes(activeWorkspaceId, selectedPlanId)
    }
  }, [viewMode, selectedPlanId, activeWorkspaceId, refetchNodes])

  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  )

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const filteredNodes = useMemo(() => {
    if (!statusFilter) return nodes
    return nodes.filter(n => n.data.status === statusFilter)
  }, [nodes, statusFilter])

  const handleDrillDown = (planId: string) => {
    setSelectedPlanId(planId)
    setSelectedNodeId(null)
    setViewMode('equipment')
  }

  const handleBack = () => {
    setViewMode('plans')
    setSelectedNodeId(null)
  }

  if (loading || plansLoading) return null

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {viewMode === 'equipment' && selectedPlan && (
        <div className="flex items-center gap-2 border-b border-border bg-[#0d1018] px-4 py-2 text-[11px]">
          <button
            onClick={handleBack}
            className="text-muted-foreground hover:text-foreground"
          >
            ← Back
          </button>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-muted-foreground">{workspaces[0]?.name}</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-semibold text-foreground">
            {selectedPlan.name}
          </span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          {viewMode === 'plans' ? (
            <IsometricMap
              zones={plans}
              nodes={[]}
              selectedZoneId={selectedPlanId}
              selectedNodeId={null}
              onZoneSelect={id =>
                setSelectedPlanId(prev => (prev === id ? null : id))
              }
              onNodeClick={() => {}}
              zoneNodeKey="planId"
            />
          ) : (
            <IsometricMap
              zones={selectedPlan ? [selectedPlan] : []}
              nodes={filteredNodes}
              selectedZoneId={selectedPlanId}
              selectedNodeId={selectedNodeId}
              onZoneSelect={() => {}}
              onNodeClick={id =>
                setSelectedNodeId(prev => (prev === id ? null : id))
              }
              zoneNodeKey="planId"
            />
          )}
        </main>
        <NodeDetailPanel
          node={selectedNode}
          plan={selectedPlan}
          workspaceId={activeWorkspaceId}
          viewMode={viewMode}
          onDrillDown={handleDrillDown}
        />
      </div>
      <MachineLegend />
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter client check-types
```

Expected: no errors.

- [ ] **Step 5: Run client tests**

```bash
pnpm --filter client test
```

Expected: all tests pass (the `use-dashboard-data` test may need updating since `refetchNodes` is new — the existing test stubs will still pass as it only checks `getNodes` calls).

- [ ] **Step 6: Commit**

```bash
git add apps/client/hooks/use-dashboard-data.ts \
        apps/client/app/(default)/dashboard/page.tsx \
        apps/client/app/(default)/dashboard/components/node-detail-panel.tsx
git commit -m "feat(client): dashboard drill-down — viewMode state, plan detail panel, breadcrumb"
```

---

## Task 14: Canvas — Add Plan Selector for Node Creation

**Files:**

- Modify: `apps/client/hooks/canvas/use-canas-edit.ts`
- Modify: `apps/client/app/(default)/workspaces/[id]/canvas/page.tsx`

`createNode` now requires `planId`. The canvas editor hook (`use-canas-edit.ts`) calls `createNode(workspaceId, data)` at line 101. We need to pass `planId` from the page down to the hook, and add a plan selector to the canvas page.

- [ ] **Step 1: Add planId param to useCanvasEditor**

In `apps/client/hooks/canvas/use-canas-edit.ts`, update the function signature to accept `planId`:

```ts
export function useCanvasEditor(
  workspaceId: string,
  remoteNodes: CanvasRFNode[],
  remoteEdges: Edge[],
  planId: string | null,   // NEW
) {
```

Update the `createNode` call at line ~101 to pass `planId`. Wrap it in a guard so creation is skipped when no plan is selected:

```ts
nodesToCreate.map(async n => {
  if (!planId) return   // guard — no plan selected
  const created = await createNode(workspaceId, planId, {
    name: n.data.name as string,
    type: n.data.type as NodeType,
    status: n.data.status as NodeStatus,
    x: n.position.x,
    y: n.position.y,
  })
  idMap.set(n.id, created.id)
}),
```

- [ ] **Step 2: Add plan selector to canvas page**

In `apps/client/app/(default)/workspaces/[id]/canvas/page.tsx`:

1. Add imports:

```ts
import { useWorkspacePlans } from '@/hooks/workspace/use-workspace-plans'
```

2. Add plan state inside `CanvasPage`:

```ts
const { plans } = useWorkspacePlans(workspaceId)
const [activePlanId, setActivePlanId] = useState<string | null>(null)
```

3. Pass `activePlanId` to `useCanvasEditor`:

```ts
const { ... } = useCanvasEditor(workspaceId, remoteNodes, remoteEdges, activePlanId)
```

4. Add a plan selector dropdown in the JSX, above `<ReactFlow>` or inside the toolbar area. Insert this after the `<CanvasToolbar ... />` closing tag:

```tsx
{
  isBuildMode && (
    <div className="absolute top-16 left-4 z-10 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-[11px]">
      <span className="text-muted-foreground">Plan:</span>
      <select
        value={activePlanId ?? ''}
        onChange={e => setActivePlanId(e.target.value || null)}
        className="bg-transparent text-foreground outline-none cursor-pointer"
      >
        <option value="">Select plan...</option>
        {plans.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter client check-types
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/client/hooks/canvas/use-canas-edit.ts \
        apps/client/app/(default)/workspaces/[id]/canvas/page.tsx
git commit -m "feat(client): add plan selector to canvas — pass planId to createNode"
```

---

## Task 15: Final Build + Format

- [ ] **Step 1: Format**

```bash
pnpm format
```

- [ ] **Step 2: Full build**

```bash
pnpm build
```

Expected: no errors across all apps.

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: format and build verification for workspace-plan refactor"
```

---

## Verification Checklist

Manual flow to verify end-to-end:

1. `pnpm dev` — start the app
2. Create a `WorkspacePlan` via `POST /api/v1/authorized/workspace-plan` (use Swagger at `/swagger` or REST client)
3. Create a `Node` with `planId` set to the new plan's id via `POST /api/v1/authorized/nodes`
4. Navigate to `/dashboard` → Plans render as isometric zones
5. Click a Plan zone → right panel shows plan name, nodeCount, alarmCount, "View Equipment →" button
6. Click "View Equipment →" → breadcrumb appears (`← Back / WorkspaceName / PlanName`), equipment nodes render in the zone
7. Click an equipment node → panel switches to equipment detail (type, name, status, models)
8. Click "← Back" → returns to plan view with plans as zones
