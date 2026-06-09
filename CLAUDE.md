# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Every Task

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system design, layer model, auth flow, and key architectural decisions. Read [`docs/CODEBASE.md`](docs/CODEBASE.md) for project structure, component APIs, Prisma patterns, and coding style. For any frontend/UI work, read [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) for color tokens, status color conventions, component patterns, and design rules. Do not rely on assumptions — verify against these files first.

## After Every Task

After completing any coding task, always run these two commands in order before reporting done:

```bash
pnpm format   # format all files (prettier)
pnpm build    # full build — catch any type/compile errors
```

Do not report a task as complete if either command fails. Fix all errors first.

## Commands

```bash
# Dev (loads root .env via dotenvx, runs all apps concurrently)
pnpm dev

# Build all
pnpm build

# Lint all
pnpm lint

# Type-check all
pnpm check-types

# Format all
pnpm format

# Database
pnpm db:generate       # regenerate Prisma client after schema changes
pnpm db:migrate:dev    # run prisma migrate dev (loads .env via dotenvx)

# Per-app (when you only need one)
pnpm --filter client dev
pnpm --filter backend dev
pnpm --filter backend lint
pnpm --filter client lint

# Single backend test
pnpm --filter backend test -- --testPathPatterns=<filename>   # Jest 30: plural

# Client tests (Vitest)
pnpm --filter client test          # run once
pnpm --filter client test:ui       # interactive Vitest UI

# All tests (root)
pnpm test                          # runs via Turborepo + dotenvx
```

## Architecture

Turborepo + pnpm monorepo. Two apps, three packages:

```text
apps/backend            # NestJS 11 + Fastify, port 8000 (SERVER_PORT env)
apps/client             # Next.js 16 App Router, port 3000
packages/prisma         # @softsensor/prisma — shared PrismaService/PrismaModule
packages/eslint-config  # shared ESLint config
packages/typescript-config # shared tsconfig bases
```

### Hooks (`.claude/hooks/`)

- PostToolUse on every Write/Edit: runs prettier → ESLint --fix → tsc --noEmit automatically.
- After any Edit, if you need to Edit the same file again, re-Read first — the formatter may have changed indentation/spacing and old_string will no longer match.
- PreToolUse blocks any write to `packages/prisma/src/generated/**` — edit `schema.prisma` instead.
- Backend ESLint config is `eslint.config.mjs` (not `.js`) — NestJS is CommonJS; `.js` with ES imports triggers `MODULE_TYPELESS_PACKAGE_JSON` warning.

### Backend (`apps/backend`)

Strict layered architecture — Controllers → Services → Prisma. No business logic in controllers.

- **HTTP adapter:** Fastify (`NestFastifyApplication`) — not Express. Use `app.register()` for plugins.
- **Entry:** `src/main.ts` — global prefix `api`, URI versioning `defaultVersion: '1'`, `HttpExceptionFilter`, `ClassSerializerInterceptor`, CORS from `CORS_ORIGINS` env
- **API routes:** all under `/api/v1/...`. Route groups: `public/` (no auth), `authorized/` (JWT), `admin/` (JWT + RBAC)
- **Module structure:** `src/api/v1/<feature>/` — each feature has `public/`, `authorized/`, `admin/` sub-modules with controller, service, and `dto/` folder
- **DTOs:** `class-validator` + `class-transformer` + `nestjs-zod`. Use `@Exclude()` on sensitive fields, `@Type()` on nested objects.
- **ValidationPipe:** currently commented out in `main.ts` — add per-controller or re-enable globally when needed.
- **Long-running work:** avoid blocking HTTP for operations >500ms; BullMQ not yet installed.
- **Auth:** `JwtAuthGuard` + `RolesGuard`. Refresh tokens in `HttpOnly` cookies only.
- **Token issuance pattern:** 15m JWT via `jwtService.sign<Auth.UserPayload>` + 64-byte hex refresh token (`randomBytes(64).toString('hex')`) persisted to `RefreshToken` + `AuthLog` entry, all in a single `prisma.$transaction`. Canonical block: `auth.public.service.ts:100-127`. Reuse for every new auth path (OAuth, SSO, etc.) — do not invent a new token shape.
- **Password reset URL:** Build as `${clientUrl}/reset-password/${token}?email=${encodeURIComponent(user.email)}` — token is a path segment matching frontend route `/reset-password/[token]`. Never use `/reset-password/confirm?token=` (route mismatch).
- **Admin submodule pattern:** `<feature>/admin/` controllers use `@UseGuards(JwtAccessGuard, RolesGuard)` + `@Roles('ADMIN')`. Role enum: `USER | ADMIN`. Canonical example: `auth/admin/auth.admin.controller.ts` (activity log + user stats) and `workspace/admin/workspace.admin.controller.ts`. Always register the new controller + service in the feature's `*.module.ts` — `AuthAdminController` + `AuthAdminService` live in `auth.module.ts`.
- **Feature sub-modules:** Not every feature needs `public/`, `authorized/`, `admin/` — create only what's needed. Example: `plan/` has `authorized/` + `admin/` only.
- **Pagination DTO convention:** Zod `PaginationQuerySchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) })`. Extend with `.extend(...)` for filters. Service runs `prisma.$transaction([findMany({ skip: (page-1)*limit, take: limit, ... }), count({ where })])` and returns `{ items, total, page, limit }` inside the standard envelope. Canonical: `auth/admin/auth.admin.service.ts`.
- **Swagger:** available at `/swagger`.
- **Error throwing:** Always use `AppException` from `@softsensor/common` for ALL thrown errors — never use NestJS built-ins (`BadRequestException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`, etc.). Shape: `throw new AppException({ statusCode: 400, message: 'Your message here', type: 'ERROR' })`. Import: `import { AppException } from '@softsensor/common'`.
- **`deriveNodeSummary()` helper:** Private method in `workspace.authorized.service.ts` — computes `{ nodeCount, alarmCount, status }` from `{ data: unknown }[]`. Reuse for any workspace endpoint needing aggregate node status. Priority: alarm(3) > offline(2) > warning(1) > normal(0).
- **Nodes module (`nodes/authorized/`):** CRUD for canvas nodes. `NodeData` JSON shape: `{ name, type, status, icon?, x, y }`. Every node requires a `planId` (nodes belong to a `WorkspacePlan`). Frontend canonical: `services/canvas.ts` — `getNodes(workspaceId, planId?)`, `createNode()`, `updateNode()`, `deleteNode()`.
- **WorkspacePlan vs Plan — naming collision:** `WorkspacePlan` (`workspace-plan/`) = a sub-floor/zone within a workspace canvas (child of `Workspace`). `Plan` (`plan/`) = user subscription tier (FREE/STANDARD/PRO) that controls `maxWorkspaces`. Completely unrelated models. Never conflate.
- **Edges:** `GET/PUT /api/v1/authorized/workspace/:id/edges` — replace-all semantics (full edge list per workspace). No per-edge CRUD. Frontend: `getEdges(workspaceId)`, `replaceEdges(workspaceId, edges)` in `services/canvas.ts`.
- **Mail module (`mail/`):** Has `authorized/` (user-facing, e.g. password reset email triggers) and `admin/` (admin bulk mail). Template files under `mail/authorized/template/`.

### Database (`packages/prisma`)

- `PrismaModule` is `@Global()` — import it once in `AppModule`, then inject `PrismaService` anywhere without re-importing the module.
- Schema at `packages/prisma/prisma/schema.prisma`; client generated to `packages/prisma/src/generated/client`.
- After any schema change: `pnpm db:migrate:dev` (auto-generates client). Run `pnpm db:generate` only to regenerate without a new migration.
- Use `prisma.$transaction([...])` for multi-step writes.
- **OAuth identity:** `Account` model (`provider`, `providerAccountId` is `@@unique`) links OAuth identities to `User`. `User.password` is nullable for OAuth-only users. Resolution order in auth flows: `prisma.account.findUnique({ where: { provider_providerAccountId: ... } })` → fall back to `User.findUnique({ email })` → create both if neither exists.

### Admin (`apps/client/app/admin/`)

- **Admin layout:** `app/admin/layout.tsx` is an async server component — calls `await auth()`, redirects unauthenticated → `/login`, non-`ADMIN` → `/`. Wraps children with `<AdminAppLayout>` (`components/admin/app-layout.tsx` → `sidebar.tsx` + `navbar.tsx`). Collapse state in `store/admin.ts` (`adminSidebarCollapsedAtom`). Never put `'use client'` here — the role gate must run server-side.
- **Activity Log page:** `app/admin/activity/` — paginated tables for `AuthLog` feed + per-user weekly login count. Per-route components live under `app/admin/activity/components/` (not under `components/admin/activity/`).
- **Admin workspace detail:** `app/admin/workspaces/[id]/settings/` — workspace settings management. Has `page.tsx`, `error.tsx`, `loading.tsx`.

### Frontend (`apps/client`)

- **Default to Server Components.** Only add `"use client"` when hooks or event listeners are required. Never put `"use client"` on a layout unless unavoidable.
- **Auth route group:** auth pages live under `app/(auth)/` — login, register, reset-password.
- **Auth config:** `lib/auth/index.ts` — NextAuth v5 config, exports `handlers`, `signIn`, `signOut`, `auth`.
- **`DecodedToken` in `lib/auth/index.ts`:** Fields must be camelCase (`firstName`, `lastName`) matching the JWT payload exactly — mismatched casing silently produces `undefined` session fields.
- **Login response shape:** Backend returns `{ data: { accessToken } }`. `authorize` reads `user.data?.accessToken ?? user.accessToken` to handle both wrapped and flat shapes.
- **NextAuth type augmentation:** `apps/client/types/next-auth.d.ts` augments `JWT`, `User`, `Session` — required string fields: `id`, `accessToken`, `refreshToken`, `role`, `firstName`, `lastName`. NextAuth defaults leave `user.email`, `account.access_token`, `account.refresh_token` as `string | null | undefined` and `account.expires_at` as `number | undefined`. When assigning these into JWT inside the `jwt()` callback (e.g. new OAuth provider branch), coerce with `?? ''` / `?? 0` or `tsc` fails with TS2322.
- **Session provider:** `components/providers/session-provider.tsx`.
- **HTTP client:** `lib/fetcher.ts` → `fetchClient()`. Uses `NEXT_PUBLIC_API_URL` as base URL. Never use `NEXT_PUBLIC_BACKEND_URL` (does not exist).
- **Service layer:** `services/` — thin wrappers over `fetchClient`. Always pass full versioned path (`/api/v1/...`).
- **State:** Jotai (`store/`) for complex client state. Use `atomWithStorage` for localStorage persistence. Store: `store/workspace.ts` — `workspacesAtom`, `createWorkspaceAtom`, `clearWorkspacesAtom`.
- **Viewport (Next.js 16):** Export `viewport` separately from `metadata`. Never put viewport settings inside the `metadata` object — `metadata.viewport` is deprecated and causes `<__next_viewport_boundary__>` key warnings at runtime.
- **Data fetching:** Next.js `fetch` with revalidation tags for server data.
- **UI components:** shadcn/ui (style: `radix-nova`) — `components/ui/` files are generated and must not be edited. Add via `npx shadcn@latest add <component>` (config at `components.json`).
- `cn()` utility is at `lib/utils.ts`.
- Tailwind v4 — CSS-first. Use CSS variables (`bg-primary`, `text-destructive`). Never hardcode hex colors.
- **Tailwind v4 display conflict:** Never combine conflicting display utilities at the same breakpoint on one element (e.g. `lg:flex` + `lg:hidden` — `lg:flex` wins). Use conditional rendering (`{condition && <el>}`) instead.
- Every route segment needs `error.tsx` and `loading.tsx`.
- Toast feedback via Sonner (`components/ui/sonner`, imported in `app/layout.tsx`).
- `ThemeProvider` at `components/providers/theme-provider.tsx`.
- **Domain directories:** `hooks/user/`, `hooks/workspace/`, `hooks/admin/` — hooks per domain. `services/profile.ts`, `services/workspace.ts`, `services/activity.ts` — fetchClient wrappers. `configs/` — client config files.
- **Domain types:** `types/dashboard.ts` — `Node`, `Workspace`, `Alert` interfaces for the dashboard/workspaces domain.
- **Workspace routes:** `(default)/workspaces/` (list), `(default)/workspaces/[id]/` (detail), `(default)/workspaces/[id]/canvas/` (canvas view). Old `(default)/workspace/[id]/` route is deleted.
- **Workspace settings hook:** `hooks/workspace/use-workspace-settings.ts` — loads workspace + members in parallel via `Promise.all`, initializes local state (`name`, `selectedIcon`, `selectedColor`). Returns `{ workspace, members, setMembers, loading, name, setName, selectedIcon, setSelectedIcon, selectedColor, setSelectedColor, refetch }`.
- **Shared paginated hook:** `hooks/use-paginated-fetch.ts` exports `usePaginatedFetch<T>(fetcher, deps, errorMessage)`. Use this instead of per-hook implementations. Returns `{ data, loading, isFetching, error, refetch }`. Do NOT pass `data` in deps array.
- **Paginated hook pattern (keepPreviousData):** Paginated client hooks (e.g. `hooks/admin/use-activity.ts`) return `{ data, loading, isFetching, error, refetch }`. Never `setData(null)` between refetches — previous items must stay visible during page changes. Derive `loading = isFetching && data === null` at return (true only on initial load); use `isFetching` to disable Prev/Next buttons + dim the table body (`cn(isFetching && 'opacity-60 transition-opacity')`). Skeleton rows render **only** on `loading`. Do NOT add `data` to the `useCallback` deps — compute the derived flag at return instead, otherwise you create a refetch loop.
- **`searchParams.get()` returns `string | null`** — guard with `if (!value) { toast.error(...); return }` before passing to service functions typed as `string`.
- **`useWatch` control:** Always destructure `control` from `useForm()` return value. Never reference `formSchema.control` — Zod schemas have no `.control` property.
- **Workspace status fields:** `getAllWorkspaces()` returns `nodeCount`, `alarmCount`, `status` per workspace — computed from `Nodes.data.status` JSON field. Workspace type in `types/index.ts` has `nodeCount?`, `alarmCount?`, `status?: 'normal' | 'warning' | 'alarm' | 'offline'`.
- **`Nodes.data` JSON shape:** Matches `NodeData` from `services/canvas.ts` — `{ status, name, type, x, y }`. Cast as `Record<string, unknown>` when reading from Prisma. Same records returned by `getNodes()` canvas service endpoint.
- **Alert count hook:** `hooks/workspace/use-alert-count.ts` → `useAlertCount()` — sums `alarmCount` from `workspacesAtom`. No extra API call. Badge count matches `/alerts` page row count.
- **Alerts page:** `(default)/alerts/` — counts only nodes (not models) with non-normal status via `getNodes()` from `services/canvas`. Sidebar badge must match this count.
- **Laws of UX:** For nav/sidebar/layout work, apply principles from `docs/DESIGN_SYSTEM.md` §12. Minimum: Von Restorff (errors visually distinct), Serial Position (Alerts near top of nav), Fitts's Law (1 click to common actions).
- **Canvas store:** `store/canvas.ts` — `isBuildModeAtom` (toggle build/view mode), `canvasActionsAtom` (delete callbacks), `useCanvasContext()` hook for canvas component tree. Import `useCanvasContext()` instead of reading atoms directly inside canvas components.
- **Isometric lib:** `lib/isomatric.ts` — `ZoneItem`, `MappedNode`, `GRID_SPACING`. Used by dashboard `IsometricMap` for 2.5D coordinate projection. Import `CanvasNode` from `services/canvas.ts` as the node type.
- **Dashboard (digital twin):** `(default)/dashboard/` — 2.5D isometric command-center view. Machine SVGs live under `components/machines/` (cnc-machine, controller, conveyor, robot-arm, sensor). `hooks/use-dashboard-data.ts` fetches all workspace nodes in parallel via `Promise.all`.
- **`types/models.ts`:** Exports mock data generators (`allWorkspaces`, `allModels`, `generateMockModels()`) — placeholder only for `/models` page until real models API is built. Do not reference or extend this pattern; connect new endpoints to real Prisma.
- **Subscription services:** `services/plan.ts` → `planService.listPlans()`, `mySubscription()`, `downgrade()`. `hooks/workspace/use-workspace-plans.ts` — CRUD for `WorkspacePlan` sub-plans within a canvas.

### Agents (`.claude/agents/`)

Project-specific subagent definitions: `api-agent`, `frontend-agent`, `test-agent`, `lint-agent`, `docs-agent`, `dev-deploy-agent`. Each contains project-accurate file structure, commands, and constraints — spawn via the Agent tool with the relevant `subagent_type`.

## Key constraints from AGENT.md

- **No `any` or `@ts-ignore`** — zero tolerance.
- **No mock data** — always connect to real Prisma/APIs.
- **Plan first** — for any new feature, outline schema + API contract + component structure before coding.
- Never modify `schema.prisma` by hand and skip migrations — always `migrate dev`.
- `components/ui/**` are immutable — never edit generated shadcn files.
- **Env vars:** `NEXT_PUBLIC_API_URL` is the backend base URL — never use `NEXT_PUBLIC_BACKEND_URL`.

## Security

Full policy at [`docs/SECURITY.md`](docs/SECURITY.md). Enforced rules when writing code:

- **Never commit `.env` files** — only `.env.example` in version control.
- **No `dangerouslySetInnerHTML`** unless content is sanitized via `dompurify`.
- **Raw Prisma queries** (`$queryRaw`) must use tagged template literals — never string concatenation.
- **Sensitive env vars** must not use `NEXT_PUBLIC_` prefix — stays server-side only.
- **Password reset / email tokens** — use `crypto.randomBytes`, short expiry (≤30 min), one-way hash before DB storage. Canonical pattern: `auth.public.service.ts`.
- **CORS** — restrict to trusted origins via `CORS_ORIGINS` env; never `origin: '*'` in production.
- **Rate limiting** — use `@nestjs/throttler` on auth and email endpoints (password reset, OTP).
- **HTTP headers** — `helmet` must be registered in `main.ts` for all environments.
