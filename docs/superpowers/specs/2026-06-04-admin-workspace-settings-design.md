# Admin Workspace Settings — Design Spec

**Date:** 2026-06-04  
**Status:** Approved

---

## Context

The admin settings page at `/admin/workspaces/[id]/settings` renders correctly but all fields are empty. Root cause: the page uses `useWorkspaceSettings` which calls `authorized` endpoints (`GET /api/v1/authorized/workspace/:id` and `GET /api/v1/authorized/workspace/:id/members`). Those endpoints call `assertHasAccess`, which throws 403 when the admin user is not a member/owner of the workspace. Mutations (update, invite, remove, role change) have the same problem — they also check ownership.

Additionally, the `Workspace` model lacks a `description` field, which is needed for the settings UI.

---

## Goals

- Admin can load **any** workspace's settings regardless of membership.
- Admin can update workspace name, icon, color, and description.
- Admin can invite, remove, and change roles for any workspace's members.
- Schema gains an optional `description` field.

---

## Schema Change

Add to `packages/prisma/prisma/schema.prisma` → `Workspace` model:

```prisma
description  String?
```

Run `pnpm db:migrate:dev` after the change.

---

## API Contract

All routes under `admin/workspace` — guarded by `JwtAccessGuard + RolesGuard + @Roles('ADMIN')`. No membership checks.

| Method   | Route                                      | Description                              |
| -------- | ------------------------------------------ | ---------------------------------------- |
| `GET`    | `/api/v1/admin/workspace/:id`              | Workspace detail + members               |
| `PATCH`  | `/api/v1/admin/workspace/:id`              | Update name / icon / color / description |
| `POST`   | `/api/v1/admin/workspace/:id/members`      | Invite member by email                   |
| `PATCH`  | `/api/v1/admin/workspace/:id/members/:mid` | Change member role                       |
| `DELETE` | `/api/v1/admin/workspace/:id/members/:mid` | Remove member                            |

### GET /:id response

```json
{
  "statusCode": 200,
  "type": "SUCCESS",
  "data": {
    "id": "uuid",
    "name": "string",
    "icon": "string",
    "color": "string",
    "description": "string | null",
    "createdAt": "ISO",
    "updatedAt": "ISO",
    "_count": { "members": 3, "models": 2 },
    "members": [
      {
        "id": "uuid",
        "userId": "uuid",
        "role": "OWNER | VIEWER",
        "createdAt": "ISO",
        "user": {
          "id": "uuid",
          "firstName": "string | null",
          "lastName": "string | null",
          "email": "string"
        }
      }
    ]
  }
}
```

### PATCH /:id body

```json
{
  "name": "string",
  "icon": "string",
  "color": "string",
  "description": "string | null"
}
```

### POST /:id/members body

```json
{ "email": "string", "role": "OWNER | VIEWER" }
```

### PATCH /:id/members/:mid body

```json
{ "role": "OWNER | VIEWER" }
```

---

## Backend Implementation

**Files to modify / create:**

### `packages/prisma/prisma/schema.prisma`

Add `description String?` to `Workspace` model.

### `apps/backend/src/api/v1/workspace/admin/dto/workspace.admin.dto.ts`

- Add `GetAdminWorkspaceByIdResponseDto`
- Add `AdminWorkspaceMemberDto` (id, userId, role, createdAt, user)
- Extend `UpdateWorkspaceRequestDto` with optional `description`
- Add `AdminInviteMemberDto` (email, role)
- Add `AdminUpdateMemberRoleDto` (role)

### `apps/backend/src/api/v1/workspace/admin/workspace.admin.service.ts`

Add methods:

- `getWorkspaceById(id)` — `prisma.workspace.findUnique` with `description`, `_count`, `members { user }` — throws 404 if not found
- Fix `updateWorkspace` — remove `memberRole !== OWNER` gate; accept `description`; allow any ADMIN
- `inviteMember(id, dto)` — same logic as authorized version, no ownership check
- `updateMemberRole(id, mid, dto)` — same logic, no ownership check
- `removeMember(id, mid)` — same logic, no ownership check

### `apps/backend/src/api/v1/workspace/admin/workspace.admin.controller.ts`

Add endpoints:

- `@Get('/:id')` → `getWorkspaceById`
- `@Post('/:id/members')` → `inviteMember`
- `@Patch('/:id/members/:mid')` → `updateMemberRole`
- `@Delete('/:id/members/:mid')` → `removeMember`

---

## Frontend Implementation

**Files to modify / create:**

### `apps/client/types/index.ts`

- Extend `WorkspaceDetail` with `description: string | null`
- Add `AdminWorkspaceDetail` (same as `WorkspaceDetail` but includes `members: WorkspaceMember[]`)

### `apps/client/services/workspace.ts`

Add admin service methods:

```ts
getAdminWorkspaceById(id) // GET /api/v1/admin/workspace/:id
adminUpdateWorkspace(id, data) // PATCH (already exists but needs description)
adminInviteMember(id, email, role) // POST /api/v1/admin/workspace/:id/members
adminUpdateMemberRole(id, mid, role) // PATCH /api/v1/admin/workspace/:id/members/:mid
adminRemoveMember(id, mid) // DELETE /api/v1/admin/workspace/:id/members/:mid
```

### `apps/client/hooks/admin/use-admin-workspace-settings.ts` (new file)

Mirrors `hooks/workspace/use-workspace-settings.ts` but:

- Calls `workspaceService.getAdminWorkspaceById(workspaceId)` (single request — returns workspace + members)
- Exposes `description` / `setDescription` state
- No separate `listMembers` call needed (members included in GET response)

### `apps/client/app/admin/workspaces/[id]/settings/page.tsx`

- Replace `useWorkspaceSettings` → `useAdminWorkspaceSettings`
- Replace `workspaceService.updateWorkspace` → `workspaceService.adminUpdateWorkspace`
- Replace `workspaceService.inviteMember` → `workspaceService.adminInviteMember`
- Replace `workspaceService.updateMemberRole` → `workspaceService.adminUpdateMemberRole`
- Replace `workspaceService.removeMember` → `workspaceService.adminRemoveMember`
- Add **Description** textarea below Name field (same `inputClass`, multiline)

---

## Data Flow

```
Page mounts
  → useAdminWorkspaceSettings(workspaceId)
    → GET /api/v1/admin/workspace/:id
      → workspace + members loaded in one request
        → name/icon/color/description state initialized
        → members array populated
```

---

## Error Handling

- `GET /:id` 404 → toast.error, redirect back to `/admin/workspaces`
- Mutation failures → toast.error with field-specific message
- Loading state: skeleton on name/description/icon/color fields and member rows

---

## Verification

1. `pnpm db:migrate:dev` succeeds
2. `pnpm build` passes (no type errors)
3. Navigate to `/admin/workspaces/<any-id>/settings` — fields populate from DB
4. Edit name/description/icon/color → Save → refresh → values persist
5. Invite a user by email → appears in member list
6. Change member role → persists on refresh
7. Remove member → removed from list
8. Test with admin user who is NOT a member of the target workspace — all operations succeed
