# SoftSensor — Codebase Documentation

## Overview

**SoftSensor** is a smart monitoring platform for industrial soft sensor management and AI model analytics.

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Monorepo | Turborepo + pnpm workspaces                       |
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5.9 |
| Backend  | NestJS 11 + Fastify, TypeScript 5.7               |
| Database | PostgreSQL via Prisma 7 (PrismaPg adapter)        |
| Styling  | Tailwind CSS v4, shadcn/ui                        |
| Runtime  | Node ≥ 20                                         |

---

## Monorepo Structure

```
SoftSensorProject/
├── apps/
│   ├── backend/           # NestJS API — port 8000
│   └── client/            # Next.js frontend — port 3000
├── packages/
│   ├── prisma/            # @softsensor/prisma — shared DB layer
│   ├── eslint-config/     # Shared ESLint config
│   └── typescript-config/ # Shared tsconfig bases
├── PLAN.md                # Development phase roadmap
├── turbo.json             # Task pipeline (build, lint, dev, check-types)
├── pnpm-workspace.yaml
└── package.json
```

### Common Scripts

```bash
pnpm dev              # Run all apps concurrently (loads .env via dotenvx)
pnpm build            # Build all
pnpm lint             # Lint all
pnpm check-types      # tsc --noEmit all
pnpm format           # Prettier all files

pnpm db:generate      # Regenerate Prisma client after schema changes
pnpm db:migrate:dev   # prisma migrate dev (loads .env via dotenvx)

# Per-app
pnpm --filter client dev
pnpm --filter backend dev
pnpm --filter backend test -- --testPathPattern=<filename>
```

---

## Backend (`apps/backend/`)

### HTTP Adapter

Backend uses **Fastify** (`NestFastifyApplication`), not Express. This affects:

- Middleware registration: `app.register(plugin)` not `app.use(middleware)`
- Request/response types: `FastifyRequest` / `FastifyReply`
- Cookie plugin: `@fastify/cookie` registered manually

### Structure

```
apps/backend/
└── src/
    ├── main.ts                      # Bootstrap — Fastify adapter, global prefix, versioning
    ├── app.module.ts                # Root module
    ├── api/
    │   └── v1/
    │       ├── auth/
    │       │   ├── auth.module.ts
    │       │   ├── public/          # POST /api/v1/public/auth/register, /login
    │       │   ├── authorized/      # POST /api/v1/authorized/auth/logout (Phase 1)
    │       │   └── admin/           # GET  /api/v1/auth/admin/activity-log, /user-stats
    │       └── workspace/
    │           ├── workspace.module.ts
    │           ├── public/          # (placeholder — no active endpoints)
    │           ├── authorized/      # (placeholder — CRUD coming Phase 5)
    │           └── admin/           # Admin workspace endpoints
    ├── common/
    │   ├── filters/http-exception.filter.ts
    │   └── decorators/             # @CurrentUser(), @Roles()
    ├── guards/
    │   ├── jwt-auth.guard.ts
    │   └── roles.guard.ts
    ├── lib/dto.ts                   # Shared response DTOs
    ├── types/
    │   ├── request.type.ts
    │   └── global.d.ts             # Auth.UserPayload namespace
    ├── config/env.ts
    └── utils/
        ├── index.ts
        └── jwt.ts
```

### Architecture

Strict layered pattern: **Controller → Service → PrismaService**. No business logic in controllers.

```
Request
  └─▶ Controller     (route handlers, DTO validation)
        └─▶ Service  (business logic)
              └─▶ PrismaService  (DB queries)
```

### API Routes

Global prefix: `api`. URI versioning with `defaultVersion: '1'`. All routes are `/api/v1/...`.

Route groups per feature module:

- `public/` — no auth guard
- `authorized/` — `JwtAuthGuard` required
- `admin/` — `JwtAccessGuard` + `RolesGuard` + `@Roles('ADMIN')` (Role enum: `USER | STAFF | ADMIN`)

### Pagination Convention

Admin list endpoints use a Zod-derived pagination DTO:

```ts
const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
// Extend with filters:
const ActivityLogQuerySchema = PaginationQuerySchema.extend({
  action: z.enum(['LOGIN', 'LOGOUT']).optional(),
  userId: z.string().optional(),
})
```

Service shape:

```ts
const where = {
  /* optional filters */
}
const [items, total] = await this.prisma.$transaction([
  this.prisma.authLog.findMany({
    where,
    include: { user: { select: { id, firstName, lastName, email } } },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  }),
  this.prisma.authLog.count({ where }),
])
return {
  statusCode: 200,
  message: 'OK',
  type: 'SUCCESS',
  data: { items, total, page, limit },
}
```

Canonical example: `apps/backend/src/api/v1/auth/admin/auth.admin.service.ts`.

### Active Endpoints

| Method | Path                               | Status     | Service                                                                     |
| ------ | ---------------------------------- | ---------- | --------------------------------------------------------------------------- |
| POST   | `/api/v1/public/auth/register`     | ✅ Done    | `registerService` — argon2 hash, create User                                |
| POST   | `/api/v1/public/auth/login`        | ✅ Done    | `loginService` — verify password, sign 15m JWT, set refresh cookie, AuthLog |
| POST   | `/api/v1/public/auth/refresh`      | ✅ Done    | `refreshService` — validate + rotate refresh token, issue new 15m JWT       |
| POST   | `/api/v1/authorized/auth/logout`   | ✅ Done    | `logoutService` — delete all user refresh tokens, clear cookie, AuthLog     |
| GET    | `/api/v1/auth/admin/activity-log`  | ✅ Done    | `AuthAdminService.listActivityLog` — paginated AuthLog feed, user joined    |
| GET    | `/api/v1/auth/admin/user-stats`    | ✅ Done    | `AuthAdminService.listUserStats` — paginated users + `logins7d` per user    |
| GET    | `/api/v1/authorized/auth/me`       | ⬜ Phase 3 | `getProfile` — commented out                                                |
| GET    | `/api/v1/authorized/workspace`     | ⬜ Phase 5 | list user workspaces                                                        |
| POST   | `/api/v1/authorized/workspace`     | ⬜ Phase 5 | create workspace                                                            |
| PATCH  | `/api/v1/authorized/workspace/:id` | ⬜ Phase 5 | update workspace                                                            |

### Login Response Shape

```json
{
  "statusCode": 200,
  "message": "เข้าสู่ระบบสำเร็จ",
  "data": { "accessToken": "<jwt>" }
}
```

JWT payload (`Auth.UserPayload`): `id`, `email`, `firstName`, `lastName`, `company`, `role`.

### Conventions

- DTOs use `class-validator` + `class-transformer` + `nestjs-zod` (`createZodDto`)
- Use `@Exclude()` on sensitive fields; `@Type()` on nested objects
- `ValidationPipe` is **not** globally active — wire per controller or re-enable in `main.ts`
- Global: `HttpExceptionFilter`, `ClassSerializerInterceptor`
- CORS: from `CORS_ORIGINS` env (comma-separated), credentials enabled
- Auth: `JwtAuthGuard` (uses `JwtStrategy` — `JWT_SECRET`, Bearer token) + `RolesGuard`. `@Users()` decorator reads `request.user` (set by Passport)
- Refresh tokens: opaque 128-char hex, stored in `RefreshToken` table, set as `refresh_token` HttpOnly cookie (7d). Rotated on every `/refresh` call. All tokens for a user deleted on `/logout`
- `import type { FastifyRequest, FastifyReply }` in controllers — required when `emitDecoratorMetadata: true`
- Errors: throw `AppException` from `@softsensor/common`, not raw `HttpException`
- Swagger at `/swagger`

### Error Response Shape

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2026-05-14T08:26:40Z"
}
```

---

## Frontend (`apps/client/`)

### Structure

```
apps/client/
├── app/
│   ├── layout.tsx                    # Root layout: fonts, AppProviders (Jotai + SessionProvider + ThemeProvider + Sonner)
│   ├── globals.css
│   ├── error.tsx                     # Segment error boundary — no <html>/<body>, just inner content
│   ├── loading.tsx
│   ├── not-found.tsx
│   ├── global-error.tsx              # Root error boundary — must have <html>/<body>
│   ├── (auth)/                       # Auth route group — no layout nesting
│   │   ├── login/
│   │   │   ├── page.tsx
│   │   │   └── components/          # form-card, login-header, social-login
│   │   ├── register/page.tsx
│   │   └── reset-password/page.tsx
│   ├── admin/                       # ADMIN-only — layout enforces role gate
│   │   ├── layout.tsx                # async server component — auth() + redirect non-ADMIN
│   │   ├── page.tsx                  # Admin overview (workspaces, users, models stats)
│   │   ├── components/               # Admin overview tables
│   │   └── activity/                 # /admin/activity — AuthLog feed + user weekly login count
│   │       ├── page.tsx
│   │       ├── loading.tsx
│   │       ├── error.tsx
│   │       └── components/           # activity-page, activity-log-table, user-stats-table
│   ├── (default)/                    # Default route group — passthrough layout (no extra providers)
│   │   ├── layout.tsx                # Passthrough only — AppProviders already in root layout
│   │   ├── page.tsx                  # / — LandingPage (redirect to /dashboard if has workspaces)
│   │   ├── dashboard/page.tsx
│   │   ├── plans/page.tsx
│   │   └── settings/
│   │       ├── page.tsx              # Thin shell — renders SettingsSidebar + tab components
│   │       └── components/
│   │           ├── settings-sidebar.tsx  # Tab: Tab type + SettingsSidebar component
│   │           ├── appearance.tsx        # AppearanceTab — theme picker
│   │           ├── account.tsx           # AccountTab — profile form (edit mode), change password
│   │           └── workspace.tsx         # WorkspaceTab — workspace list + detail editor
│   └── api/auth/[...nextauth]/       # NextAuth route handler
├── components/
│   ├── navbar.tsx                   # Top bar — session-aware, skeleton on loading
│   ├── sidebar.tsx                  # Left sidebar — workspace list, nav, collapse
│   ├── app-layout.tsx               # Layout wrapper combining navbar + sidebar
│   ├── dashboard-content.tsx
│   ├── auth/
│   │   ├── auth-panel.tsx           # Login/register panel for unauthenticated root page
│   │   ├── create-workspace-form.tsx # Create first workspace → redirect /dashboard
│   │   ├── login-form.tsx
│   │   └── index.ts
│   ├── providers/
│   │   ├── session-provider.tsx     # JotaiProvider + next-auth SessionProvider
│   │   ├── theme-provider.tsx       # next-themes wrapper
│   │   └── index.ts
│   └── ui/                          # shadcn/ui — DO NOT EDIT
├── hooks/
│   ├── auth/
│   │   ├── use-auth.ts
│   │   └── use-register.ts
│   ├── admin/
│   │   └── use-activity.ts          # useActivityLog, useUserStats — paginated, keepPreviousData
│   ├── user/
│   ├── workspace/
│   ├── use-mobile.ts
│   └── use-toadst.ts
├── lib/
│   ├── auth/
│   │   └── index.ts                 # NextAuth v5 config — handlers, signIn, signOut, auth
│   ├── validations/
│   │   └── auth.dto.ts
│   ├── fetcher.ts                   # fetchClient() — central HTTP client
│   └── utils.ts                     # cn() — clsx + tailwind-merge
├── services/
│   ├── auth.ts                      # authService.register, authService.logout
│   ├── workspace.ts                 # workspace CRUD wrappers
│   └── activity.ts                  # activityService.getActivityLog, getUserStats
├── store/
│   └── workspace.ts                 # Jotai atoms — workspacesAtom, createWorkspaceAtom, clearWorkspacesAtom
├── types/
│   ├── index.ts                     # UserProfile, RegisterPayload, Workspace, CreateWorkspaceInput, ActivityLog, UserActivityStats, Paginated<T>, AuthAction, …
│   └── next-auth.d.ts               # Extends NextAuth Session/User/JWT with id, role, accessToken, firstName, lastName
└── proxy.ts
```

### Environment Variables

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000   # Backend base URL — fetchClient + NextAuth authorize
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

> `NEXT_PUBLIC_BACKEND_URL` does **not** exist. Always use `NEXT_PUBLIC_API_URL`.

### fetchClient (`lib/fetcher.ts`)

Central HTTP client for all API calls from client components.

- Reads `NEXT_PUBLIC_API_URL` as base URL
- Sets `Content-Type: application/json` (if not overridden)
- Injects `Authorization: Bearer <accessToken>` from `getSession()`
- On 401: calls `signOut({ callbackUrl: '/login' })` + throws
- On non-ok: throws `Error(errorData.message || 'API Error: <status>')`
- Returns `response.json()` on success

```ts
fetchClient(endpoint: string, options?: RequestInit): Promise<unknown>
// endpoint is full versioned path: '/api/v1/public/auth/register'
```

### Auth (`lib/auth/index.ts`)

NextAuth v5 config. Credentials provider calls `NEXT_PUBLIC_API_URL/api/v1/public/auth/login`.

**Critical:** `DecodedToken` fields must be camelCase (`firstName`, `lastName`) — JWT payload uses camelCase. Mismatch silently produces `undefined` session fields.

**Refresh token flow (Phase 1+2):**

1. `authorize` calls backend login → backend sets `refresh_token` HttpOnly cookie in response **and** returns `{ data: { accessToken } }`.
2. Since `authorize` is server-to-server, the browser never receives the backend cookie directly. Instead, `authorize` parses `refresh_token` from the `Set-Cookie` response header and stores it inside NextAuth's encrypted JWT (`token.refreshToken`).
3. On each request the `jwt` callback checks `Date.now() < token.expiresAt - 60_000`. If the access token is still valid it returns unchanged.
4. When expired, `jwt` calls `POST /api/v1/public/auth/refresh` with `Cookie: refresh_token=<stored>` header (manual forwarding). The backend rotates the token; `jwt` updates `token.accessToken`, `token.refreshToken`, and `token.expiresAt`.
5. On failure: `token.error = 'RefreshTokenExpired'` → `session.error` is exposed → `proxy.ts` redirects to `/login`.

JWT `maxAge`: 7 days (matches refresh token TTL). Session user has: `id`, `email`, `role`, `accessToken`, `firstName`, `lastName`. `session.error` signals expired refresh token to the client.

OAuth providers (Google, Microsoft) are prepared but commented out.

### Middleware (`proxy.ts`)

Auth guard for all non-static routes. Redirects to `/login` when unauthenticated **or** when `session.error === 'RefreshTokenExpired'`. Redirects authenticated users away from `/login` and `/register` to `/dashboard`.

### Providers (`components/providers/session-provider.tsx`)

`AppProviders` wraps the whole app — lives in root `app/layout.tsx` only. Do **not** add `SessionProvider` or `AppProviders` in segment layouts; that causes triple-nesting and breaks `useSession`.

```tsx
<ThemeProvider>
  <JotaiProvider>
    <TooltipProvider>
      <SessionProvider>
        {children}
        <Toaster />
      </SessionProvider>
    </TooltipProvider>
  </JotaiProvider>
</ThemeProvider>
```

### Viewport (Next.js 15)

Export `viewport` **separately** from `metadata` in layouts/pages:

```ts
import type { Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}
```

Never put viewport settings inside `metadata` — `metadata.viewport` is deprecated in Next.js 15 and causes `<__next_viewport_boundary__>` React key warnings.

### State (`store/workspace.ts`)

Jotai atoms — replaces the old Zustand store.

```ts
// Read workspaces
const workspaces = useAtomValue(workspacesAtom)

// Write — create workspace
const createWorkspace = useSetAtom(createWorkspaceAtom)
createWorkspace({ name, icon, color })

// Write — clear all
const clearWorkspaces = useSetAtom(clearWorkspacesAtom)
```

`workspacesAtom` is persisted to `localStorage` key `"workspaces"` via `atomWithStorage`.

> **Note:** After migration from Zustand, old `localStorage` key `"workspace-store"` is dead. Browser DevTools → Application → Local Storage → delete `workspace-store` if workspaces don't load.

### Services (`services/`)

Thin wrappers over `fetchClient`. Always pass full versioned path.

```ts
authService.register(data) // POST /api/v1/public/auth/register
authService.logout() // POST /api/v1/authorized/auth/logout
```

### Settings Page (`app/settings/`)

`page.tsx` is a thin shell — manages `activeTab` state only.
Each tab is an independent client component in `app/settings/components/`:

| Component              | Responsibility                                                    |
| ---------------------- | ----------------------------------------------------------------- |
| `settings-sidebar.tsx` | Tab navigation; exports `Tab` type                                |
| `appearance.tsx`       | Theme picker (light / dark / system)                              |
| `account.tsx`          | Profile form with `isEditing` toggle; Change Password card        |
| `workspace.tsx`        | Workspace selector grid + details editor (Jotai `workspacesAtom`) |

### Admin Layout & Activity Log (`app/admin/`)

`app/admin/layout.tsx` is an **async server component** that enforces role gating before mounting any admin page:

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AdminAppLayout } from '@/components/admin/app-layout'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/')
  return <AdminAppLayout>{children}</AdminAppLayout>
}
```

Never add `'use client'` to this file — the gate must run server-side. `AdminAppLayout` stays the client wrapper for sidebar/navbar Jotai state.

`/admin/activity` renders two paginated tables:

| Section          | Hook             | Columns                                                 |
| ---------------- | ---------------- | ------------------------------------------------------- |
| Activity Log     | `useActivityLog` | User, Email, Action (LOGIN/LOGOUT badge), Timestamp     |
| User Stats (7 d) | `useUserStats`   | User, Email, Role, Joined, Logins (7 d) — right aligned |

Sidebar entry already exists in `components/admin/sidebar.tsx` (`id: 'activity'`, `href: '/admin/activity'`).

### Paginated Hook Pattern (keepPreviousData)

Paginated client hooks under `hooks/admin/` follow this shape so previous rows stay visible on Prev/Next while the next page is in flight — no skeleton flash mid-pagination:

```ts
export function useActivityLog({ page, limit, action, userId }: Options) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<ActivityLog> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await activityService.getActivityLog({
        page,
        limit,
        action,
        userId,
      })
      setData(res.data)
    } catch {
      setError('Failed to load activity log')
      toast.error('Failed to load activity log')
    } finally {
      setIsFetching(false)
    }
  }, [page, limit, action, userId]) // NOTE: do NOT add `data` here — refetch loop

  useEffect(() => {
    if (status !== 'authenticated') return
    fetchData()
  }, [fetchData, status])

  return {
    data,
    loading: isFetching && data === null, // true only on initial load
    isFetching, // true on every fetch (page change, refetch)
    error,
    refetch: fetchData,
  }
}
```

Consumers:

- Render skeleton rows **only** on `loading` (no data yet at all).
- Keep rendering `data?.items` while `isFetching === true` — page change does not unmount rows.
- Disable Prev/Next via `isFetching || page === 1` (and analogous Next bound).
- Dim the body: `<TableBody className={cn(isFetching && data !== null && 'opacity-60 transition-opacity')}>`.

Canonical: `apps/client/hooks/admin/use-activity.ts` + `apps/client/app/admin/activity/components/activity-log-table.tsx`.

---

## Components (`apps/client/components/`)

### `navbar.tsx`

```ts
interface NavbarProps {
  onCreateWorkspace?: () => void
  onMenuClick?: () => void
}
```

Shows skeleton on `status === 'loading'`. Shows user initials + dropdown when authenticated.

### `sidebar.tsx`

```ts
interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeWorkspace: string
  onWorkspaceChange: (id: string) => void
  workspaceOpen: boolean
  onWorkspaceToggle: () => void
}
```

Active nav detection: exact match for `/`, `startsWith` for all others.
Reads workspaces from `workspacesAtom` via `useAtomValue`.

### shadcn/ui (`components/ui/` — immutable)

> Never edit these files. Add new components via `npx shadcn@latest add <component>`.
> Config: `components.json` — style: `radix-nova`.

| Category   | Components                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Layout     | `accordion`, `card`, `breadcrumb`, `sheet`, `scroll-area`, `separator`, `sidebar`                                     |
| Forms      | `alert-dialog`, `checkbox`, `command`, `input`, `input-group`, `label`, `radio-group`, `select`, `switch`, `textarea` |
| Navigation | `dropdown-menu`, `navigation-menu`, `tabs`                                                                            |
| Feedback   | `alert`, `badge`, `calendar`, `dialog`, `popover`, `progress`, `skeleton`, `tooltip`, `sonner`                        |
| Data       | `table`, `chart`                                                                                                      |
| Other      | `avatar`, `button`, `slider`                                                                                          |

### Utilities

```ts
// lib/utils.ts
export function cn(...inputs: ClassValue[]): string
// Merge Tailwind classes — resolves conflicts correctly
```

---

## Prisma (`packages/prisma/`)

### Structure

```
packages/prisma/
├── prisma/
│   ├── schema.prisma           # Source of truth — edit here only
│   ├── migrations/             # Migration history (committed)
│   └── generated/              # Auto-generated — DO NOT EDIT
└── src/
    ├── prisma.service.ts
    ├── prisma.module.ts        # @Global() NestJS module
    ├── index.ts
    └── generated/client/       # Prisma Client — DO NOT EDIT
```

### Models

| Model          | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `User`         | Core user — email, password (argon2), firstName, lastName, company, role |
| `Account`      | OAuth provider links (Google, Microsoft)                                 |
| `Workspace`    | User workspaces — name, icon, color, owner                               |
| `Model`        | ML models inside a workspace                                             |
| `RefreshToken` | Active refresh tokens (Phase 1)                                          |
| `AuthLog`      | Login/logout audit trail — action, IP, userAgent                         |
| `WorkspaceLog` | Workspace CRUD audit trail                                               |

### Workflow

```bash
# After any schema.prisma change:
pnpm db:generate      # regenerate Prisma client
pnpm db:migrate:dev   # create migration file + apply

# Multi-step writes:
await prisma.$transaction([...])
```

`PrismaModule` is `@Global()` — import once in `AppModule`, inject `PrismaService` anywhere.

---

## Coding Style

### Server vs Client Components

```
Default → Server Component (no directive)
Needs useState / useEffect / event handlers → add 'use client'
Layouts → NEVER add 'use client' unless absolutely unavoidable
```

### Route Segment Files

Every route segment must have:

```
app/some-route/
├── page.tsx      ✅ Required
├── loading.tsx   ✅ Required
└── error.tsx     ✅ Required
```

### Styling Rules

| Rule                | Detail                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| Colors              | CSS variables only — `bg-primary`, `text-destructive`, `text-muted-foreground` |
| No hex              | Never hardcode `#fff`, `rgb(...)`                                              |
| Conditional classes | Always use `cn()`                                                              |
| Responsive          | Mobile-first: base → `sm:` (640px) → `lg:` (1024px)                            |
| Dark mode           | `dark:` variant or CSS variables via `ThemeProvider`                           |

### Data Fetching

```
Server data (static/ISR)  → Next.js fetch() with revalidation tags
Client atom state         → Jotai (store/auth.ts)
Client API calls          → fetchClient() via service layer (services/)
```

### Import Aliases

```ts
'@/'              → apps/client/ root
'@/components/ui' → shadcn components (immutable)
'@/components'    → custom components
'@/lib/fetcher'   → fetchClient
'@/lib/auth'      → NextAuth config
'@/lib/utils'     → cn()
'@/hooks'         → custom hooks
'@/services'      → API service wrappers
'@/store'         → Jotai atoms (workspace.ts)
'@/types'         → shared TypeScript interfaces
```

### No-Nos

- No `any` or `@ts-ignore` — zero tolerance
- No mock data — always connect to real Prisma/APIs
- Never edit `components/ui/**` — use `npx shadcn@latest add`
- Never skip `pnpm db:migrate:dev` after schema changes
- Never use `NEXT_PUBLIC_BACKEND_URL` — correct var is `NEXT_PUBLIC_API_URL`
- Never write `@softsensor/common` `AppException` as plain `HttpException`
- After any Edit, re-Read the file before a second Edit — the PostToolUse formatter may have changed whitespace
