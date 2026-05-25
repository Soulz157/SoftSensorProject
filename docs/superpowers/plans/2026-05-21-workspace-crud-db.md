# Workspace CRUD — Wire to DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all local-only workspace mutations (create, update, delete) with real DB calls through the backend API, and add a delete endpoint that any authenticated workspace owner can use.

**Architecture:** Backend gains three new routes on the authorized tier (`POST`, `PATCH :id`, `DELETE :id`). Frontend replaces the local `createWorkspaceAtom` with a `useCreateWorkspace` hook, adds a `useDeleteWorkspace` hook, and wires `useUpdateWorkspace` to the existing PATCH service call. All state still lands in `workspacesAtom` (Jotai + localStorage) but is now sourced from DB.

**Tech Stack:** NestJS 11 + Prisma (backend), Next.js 16 + Jotai + Sonner (frontend), nestjs-zod DTOs, `fetchClient` service layer

---

## File Map

| Action     | Path                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| **Modify** | `apps/backend/src/api/v1/workspace/authorized/dto/workspace.authorized.dto.ts`    |
| **Modify** | `apps/backend/src/api/v1/workspace/authorized/workspace.authorized.service.ts`    |
| **Modify** | `apps/backend/src/api/v1/workspace/authorized/workspace.authorized.controller.ts` |
| **Modify** | `apps/client/services/workspace.ts`                                               |
| **Modify** | `apps/client/store/workspace.ts`                                                  |
| **Modify** | `apps/client/hooks/workspace/use-update-workspace.ts`                             |
| **Modify** | `apps/client/components/auth/create-workspace-form.tsx`                           |
| **Create** | `apps/client/hooks/workspace/use-create-workspace.ts`                             |
| **Create** | `apps/client/hooks/workspace/use-delete-workspace.ts`                             |

---

### Task 1: Backend — Authorized DTOs

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/authorized/dto/workspace.authorized.dto.ts`

- [ ] **Step 1: Replace empty DTO file with actual schemas**

```typescript
import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'

export const CreateWorkspaceAuthorizedRequestSchema = z.object({
  name: z.string().min(1, 'ชื่อ workspace ต้องไม่ว่างเปล่า'),
  color: z.string().min(1, 'สี workspace ต้องไม่ว่างเปล่า'),
  icon: z.string().min(1, 'ไอคอน workspace ต้องไม่ว่างเปล่า'),
})

export const UpdateWorkspaceAuthorizedRequestSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
})

export class CreateWorkspaceAuthorizedRequestDto extends createZodDto(
  CreateWorkspaceAuthorizedRequestSchema,
) {}

export class UpdateWorkspaceAuthorizedRequestDto extends createZodDto(
  UpdateWorkspaceAuthorizedRequestSchema,
) {}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/api/v1/workspace/authorized/dto/workspace.authorized.dto.ts
git commit -m "feat(backend): add authorized workspace DTOs for create/update"
```

---

### Task 2: Backend — Authorized Service (create / update / delete)

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/authorized/workspace.authorized.service.ts`

- [ ] **Step 1: Replace service file with full CRUD implementation**

```typescript
import { Injectable } from '@nestjs/common'
import { AppException } from '@softsensor/common'
import { PrismaService } from '@softsensor/prisma'
import {
  CreateWorkspaceAuthorizedRequestDto,
  UpdateWorkspaceAuthorizedRequestDto,
} from './dto/workspace.authorized.dto'

@Injectable()
export class WorkspaceAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private mapWorkspace(ws: {
    id: string
    name: string
    icon: string
    color: string
    _count: { models: number }
  }) {
    return {
      id: ws.id,
      name: ws.name,
      icon: ws.icon,
      color: ws.color,
      modelsCount: ws._count.models,
    }
  }

  async getAllWorkspaces(user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      })
    }
    const workspaces = await this.prisma.workspace.findMany({
      where: { ownerId: user.id, deletedAt: null },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
        _count: { select: { models: true } },
      },
    })
    return {
      statusCode: 200,
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS',
      data: workspaces.map(ws => this.mapWorkspace(ws)),
    }
  }

  async getWorkspaceById(id: string, user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      })
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true,
        color: true,
        name: true,
        icon: true,
        _count: { select: { models: true } },
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
      message: 'ดึงข้อมูล workspace สำเร็จ',
      type: 'SUCCESS',
      data: this.mapWorkspace(workspace),
    }
  }

  async createWorkspace(
    user: Auth.UserPayload,
    args: CreateWorkspaceAuthorizedRequestDto,
  ) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      })
    }
    const workspace = await this.prisma.workspace.create({
      data: {
        name: args.name,
        color: args.color,
        icon: args.icon,
        ownerId: user.id,
      },
      select: {
        id: true,
        name: true,
        color: true,
        icon: true,
        _count: { select: { models: true } },
      },
    })
    return {
      statusCode: 201,
      message: 'สร้าง workspace สำเร็จ',
      type: 'SUCCESS',
      data: this.mapWorkspace(workspace),
    }
  }

  async updateWorkspace(
    id: string,
    user: Auth.UserPayload,
    args: UpdateWorkspaceAuthorizedRequestDto,
  ) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      })
    }
    const existing = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
    })
    if (!existing) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }
    if (existing.ownerId !== user.id) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      })
    }
    const workspace = await this.prisma.workspace.update({
      where: { id },
      data: {
        ...(args.name && { name: args.name }),
        ...(args.color && { color: args.color }),
        ...(args.icon && { icon: args.icon }),
      },
      select: {
        id: true,
        name: true,
        color: true,
        icon: true,
        _count: { select: { models: true } },
      },
    })
    return {
      statusCode: 200,
      message: 'อัปเดต workspace สำเร็จ',
      type: 'SUCCESS',
      data: this.mapWorkspace(workspace),
    }
  }

  async deleteWorkspace(id: string, user: Auth.UserPayload) {
    if (!user) {
      throw new AppException({
        statusCode: 401,
        message: 'Unauthorized',
        type: 'ERROR',
      })
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id, deletedAt: null },
    })
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      })
    }
    if (workspace.ownerId !== user.id) {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      })
    }
    await this.prisma.workspace.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return {
      statusCode: 200,
      message: 'ลบ workspace สำเร็จ',
      type: 'SUCCESS',
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/api/v1/workspace/authorized/workspace.authorized.service.ts
git commit -m "feat(backend): add create/update/delete to authorized workspace service"
```

---

### Task 3: Backend — Authorized Controller (POST / PATCH / DELETE)

**Files:**

- Modify: `apps/backend/src/api/v1/workspace/authorized/workspace.authorized.controller.ts`

- [ ] **Step 1: Add three new routes**

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
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WorkspaceAuthorizedService } from './workspace.authorized.service'
import { JwtAccessGuard } from '@/guards/jwt-access.guard'
import { Users } from '@/common/decorators/user.decorator'
import {
  CreateWorkspaceAuthorizedRequestDto,
  UpdateWorkspaceAuthorizedRequestDto,
} from './dto/workspace.authorized.dto'

@Controller('authorized/workspace')
@ApiTags('Authorized Workspace')
@UseGuards(JwtAccessGuard)
export class WorkspaceAuthorizedController {
  constructor(
    private readonly workspaceAuthorizedService: WorkspaceAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  async getAllWorkspaces(@Users() user: Auth.UserPayload) {
    return this.workspaceAuthorizedService.getAllWorkspaces(user)
  }

  @Get('/:id')
  @HttpCode(200)
  async getWorkspaceById(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.getWorkspaceById(id, user)
  }

  @Post('/')
  @HttpCode(201)
  async createWorkspace(
    @Users() user: Auth.UserPayload,
    @Body() args: CreateWorkspaceAuthorizedRequestDto,
  ) {
    return this.workspaceAuthorizedService.createWorkspace(user, args)
  }

  @Patch('/:id')
  @HttpCode(200)
  async updateWorkspace(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
    @Body() args: UpdateWorkspaceAuthorizedRequestDto,
  ) {
    return this.workspaceAuthorizedService.updateWorkspace(id, user, args)
  }

  @Delete('/:id')
  @HttpCode(200)
  async deleteWorkspace(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspaceAuthorizedService.deleteWorkspace(id, user)
  }
}
```

- [ ] **Step 2: Run backend build to verify**

```bash
pnpm --filter backend build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/api/v1/workspace/authorized/workspace.authorized.controller.ts
git commit -m "feat(backend): add POST/PATCH/DELETE routes to authorized workspace controller"
```

---

### Task 4: Frontend — Service layer (add delete, keep create/update)

**Files:**

- Modify: `apps/client/services/workspace.ts`

- [ ] **Step 1: Add `deleteWorkspace` method**

```typescript
import { fetchClient } from '@/lib/fetcher'
import type { CreateWorkspaceInput, UpdateWorkspacePayload } from '@/types'

export const workspaceService = {
  getWorkspaces: () =>
    fetchClient('/api/v1/authorized/workspace', { method: 'GET' }),

  createWorkspace: (data: CreateWorkspaceInput) =>
    fetchClient('/api/v1/authorized/workspace', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateWorkspace: (id: string, data: UpdateWorkspacePayload) =>
    fetchClient(`/api/v1/authorized/workspace/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteWorkspace: (id: string) =>
    fetchClient(`/api/v1/authorized/workspace/${id}`, { method: 'DELETE' }),
}
```

---

### Task 5: Frontend — Store (add deleteWorkspaceAtom, remove local create)

**Files:**

- Modify: `apps/client/store/workspace.ts`

- [ ] **Step 1: Replace `createWorkspaceAtom` with `deleteWorkspaceAtom`**

```typescript
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Workspace } from '@/types'

export const workspacesAtom = atomWithStorage<Workspace[]>('workspaces', [])

export const sidebarCollapsedAtom = atomWithStorage('sidebar-collapsed', false)

export const deleteWorkspaceAtom = atom(null, (get, set, id: string) => {
  set(
    workspacesAtom,
    get(workspacesAtom).filter(w => w.id !== id),
  )
})

export const clearWorkspacesAtom = atom(null, (_get, set) => {
  set(workspacesAtom, [])
})
```

Note: `createWorkspaceAtom` is removed — creation is now handled by `useCreateWorkspace` hook which calls the API and updates `workspacesAtom` directly.

---

### Task 6: Frontend — `useCreateWorkspace` hook

**Files:**

- Create: `apps/client/hooks/workspace/use-create-workspace.ts`

- [ ] **Step 1: Create hook**

```typescript
'use client'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { CreateWorkspaceInput, Workspace } from '@/types'

export function useCreateWorkspace() {
  const [isCreating, setIsCreating] = useState(false)
  const setWorkspaces = useSetAtom(workspacesAtom)

  const createWorkspace = async (data: CreateWorkspaceInput) => {
    setIsCreating(true)
    try {
      const res = (await workspaceService.createWorkspace(data)) as {
        data: Workspace
      }
      setWorkspaces(prev => [...prev, res.data])
      return { success: true, workspace: res.data }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create workspace'
      toast.error(message)
      return { success: false, error: message }
    } finally {
      setIsCreating(false)
    }
  }

  return { createWorkspace, isCreating }
}
```

---

### Task 7: Frontend — `useDeleteWorkspace` hook

**Files:**

- Create: `apps/client/hooks/workspace/use-delete-workspace.ts`

- [ ] **Step 1: Create hook**

```typescript
'use client'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { deleteWorkspaceAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'

export function useDeleteWorkspace() {
  const [isDeleting, setIsDeleting] = useState(false)
  const deleteFromStore = useSetAtom(deleteWorkspaceAtom)

  const deleteWorkspace = async (id: string) => {
    setIsDeleting(true)
    try {
      await workspaceService.deleteWorkspace(id)
      deleteFromStore(id)
      toast.success('Workspace deleted')
      return { success: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete workspace'
      toast.error(message)
      return { success: false, error: message }
    } finally {
      setIsDeleting(false)
    }
  }

  return { deleteWorkspace, isDeleting }
}
```

---

### Task 8: Frontend — Wire `useUpdateWorkspace` to API

**Files:**

- Modify: `apps/client/hooks/workspace/use-update-workspace.ts`

- [ ] **Step 1: Replace local-only implementation with API call**

```typescript
'use client'
import { useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { workspaceService } from '@/services/workspace'
import type { UpdateWorkspacePayload, Workspace } from '@/types'

export function useUpdateWorkspace() {
  const [isUpdating, setIsUpdating] = useState(false)
  const setWorkspaces = useSetAtom(workspacesAtom)

  const updateWorkspace = async (id: string, data: UpdateWorkspacePayload) => {
    setIsUpdating(true)
    try {
      const res = (await workspaceService.updateWorkspace(id, data)) as {
        data: Workspace
      }
      setWorkspaces(prev => prev.map(w => (w.id === id ? res.data : w)))
      return { success: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update workspace'
      toast.error(message)
      return { success: false, error: message }
    } finally {
      setIsUpdating(false)
    }
  }

  return { updateWorkspace, isUpdating }
}
```

---

### Task 9: Frontend — Update `CreateWorkspaceForm` to use hook

**Files:**

- Modify: `apps/client/components/auth/create-workspace-form.tsx`

- [ ] **Step 1: Replace atom usage with `useCreateWorkspace` hook**

Replace the import and usage:

```diff
- import { useSetAtom } from 'jotai'
- import { createWorkspaceAtom } from '@/store/workspace'
+ import { useCreateWorkspace } from '@/hooks/workspace/use-create-workspace'
```

Replace inside `CreateWorkspaceForm`:

```diff
- const createWorkspace = useSetAtom(createWorkspaceAtom)
+ const { createWorkspace, isCreating } = useCreateWorkspace()
```

Replace `handleSubmit`:

```typescript
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!name.trim()) return
  setLoading(true)
  try {
    const result = await createWorkspace({ name: name.trim(), icon, color })
    if (result.success) {
      toast.success('Workspace created', {
        description: 'You can now create models and start monitoring!',
      })
      router.push('/dashboard')
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Something went wrong')
  } finally {
    setLoading(false)
  }
}
```

Replace submit button disabled condition:

```diff
- <Button type="submit" className="w-full" disabled={loading}>
- {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
+ <Button type="submit" className="w-full" disabled={loading || isCreating}>
+ {(loading || isCreating) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
```

- [ ] **Step 2: Run format + full build**

```bash
pnpm format && pnpm build
```

Expected: no errors. Fix any TypeScript errors before proceeding.

- [ ] **Step 3: Commit all frontend changes**

```bash
git add \
  apps/client/services/workspace.ts \
  apps/client/store/workspace.ts \
  apps/client/hooks/workspace/use-create-workspace.ts \
  apps/client/hooks/workspace/use-delete-workspace.ts \
  apps/client/hooks/workspace/use-update-workspace.ts \
  apps/client/components/auth/create-workspace-form.tsx
git commit -m "feat(client): wire workspace CRUD to DB — create/update/delete via API"
```

---

## Verification

1. Start dev: `pnpm dev`
2. Register/login → reach the create-workspace page
3. Create a workspace → verify it appears in the DB (`SELECT * FROM "Workspace"`) and in the sidebar
4. Refresh the page → workspace persists (loaded from DB, not just localStorage)
5. From settings, update workspace name/icon/color → verify DB row changes
6. Delete a workspace → verify `deletedAt` is set in DB and workspace disappears from UI
7. `pnpm build` passes with zero errors
