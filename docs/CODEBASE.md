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
    │       │   ├── public/          # POST /api/v1/public/auth/register, login
    │       │   └── authorized/      # POST /api/v1/authorized/auth/logout, refresh
    │       └── workspace/
    │           ├── workspace.module.ts
    │           ├── public/          # Public workspace endpoints
    │           ├── authorized/      # User workspace endpoints
    │           └── admin/           # Admin workspace endpoints
    ├── common/
    │   ├── filters/http-exception.filter.ts
    │   └── decorators/             # @CurrentUser(), @Roles()
    ├── guards/
    │   ├── jwt-auth.guard.ts
    │   └── roles.guard.ts
    ├── lib/dto.ts                   # Shared response DTOs (ResponseFailedDto, etc.)
    ├── types/
    │   ├── request.type.ts
    │   └── global.d.ts
    └── utils/index.ts
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
- `admin/` — `JwtAuthGuard` + `RolesGuard` (ADMIN role)

### Conventions

- DTOs validated with `class-validator` + `class-transformer`; also uses `nestjs-zod` where applicable
- Use `@Exclude()` on sensitive fields; `@Type()` on nested objects
- `ValidationPipe` is **not** globally active by default — wire it per controller or re-enable globally in `main.ts`
- Global: `HttpExceptionFilter`, `ClassSerializerInterceptor`
- CORS: from `CORS_ORIGINS` env (comma-separated). Credentials enabled.
- Auth: `JwtAuthGuard` + `RolesGuard`. Refresh tokens in `HttpOnly` cookies only.
- Long-running work (>500ms): delegate to BullMQ (not yet installed — block HTTP until added)
- Swagger at `/swagger` (Fastify-compatible, uses `nestjs-zod`'s `cleanupOpenApiDoc`)

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
│   ├── layout.tsx                    # Root layout: fonts, ThemeProvider, TooltipProvider, Sonner
│   ├── globals.css
│   ├── page.tsx                      # / — LandingPage
│   ├── error.tsx                     # Root error boundary
│   ├── loading.tsx                   # Root loading state
│   ├── (auth)/                       # Auth route group (no layout nesting)
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── reset-password/page.tsx
│   ├── api/
│   │   └── auth/                     # NextAuth route handler
│   ├── dashboard/page.tsx
│   ├── settings/page.tsx
│   └── plans/page.tsx
├── components/
│   ├── navbar.tsx
│   ├── sidebar.tsx
│   ├── app-layout.tsx
│   ├── dashboard-content.tsx
│   ├── providers/
│   │   ├── session-providers.tsx     # next-auth SessionProvider
│   │   └── theme-provider.tsx        # next-themes wrapper
│   └── ui/                           # shadcn/ui — DO NOT EDIT
├── hooks/
│   ├── auth/
│   │   ├── use-auth.ts
│   │   └── use-register.ts
│   ├── use-mobile.ts
│   └── use-toadst.ts
├── lib/
│   ├── auth/
│   │   └── index.ts                  # NextAuth config + exported handlers/signIn/signOut/auth
│   ├── validations/
│   │   └── auth.dto.ts
│   └── utils.ts                      # cn() — clsx + tailwind-merge
├── services/
│   └── auth.ts                       # authService — wraps fetchClient for auth endpoints
├── store/
│   └── auth-store.ts                 # useWorkspaceStore (Zustand + persist)
├── types/
│   └── index.ts                      # Shared TS interfaces (UserProfile, RegisterPayload, etc.)
└── proxy.ts
```

### Environment Variables

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000   # Backend base URL — used by fetchClient and NextAuth authorize
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

> `NEXT_PUBLIC_BACKEND_URL` does **not** exist. Always use `NEXT_PUBLIC_API_URL`.

### fetchClient (`lib/fetcher.ts`)

Central HTTP client. Automatically:

- Reads `NEXT_PUBLIC_API_URL` as base URL
- Sets `Content-Type: application/json`
- Injects `Authorization: Bearer <accessToken>` from session
- On 401: calls `signOut({ callbackUrl: '/login' })`
- On non-ok: throws `Error(errorData.message)`
- Always calls `response.json()` — backend must return a JSON body on success

```ts
fetchClient(endpoint: string, options?: RequestInit): Promise<unknown>
// endpoint is relative: '/api/v1/public/auth/register'
```

### Auth (`lib/auth/index.ts`)

NextAuth v5 (beta) config. Credentials provider calls `NEXT_PUBLIC_API_URL/api/public/auth/login`.
Exports: `handlers`, `signIn`, `signOut`, `auth`.
OAuth providers (Google, Microsoft) are prepared but commented out.

JWT strategy: `accessToken`, `id`, `role` stored in token → session.

### Services (`services/`)

Thin wrappers over `fetchClient`. Service methods must pass the full versioned path.

```ts
// Correct
fetchClient('/api/v1/public/auth/register', {
  method: 'POST',
  body: JSON.stringify(data),
})

// login endpoint (used in NextAuth authorize) — note: no v1 prefix in auth config yet
// '/api/public/auth/login'  ← verify against backend versioning
```

### Hooks (`hooks/auth/`)

```ts
useRegister() // → { register(data: RegisterPayload): Promise<void>, isLoading: boolean }
useAuth() // → session management helpers
```

### Store (`store/auth-store.ts`)

`useWorkspaceStore` — Zustand with `persist` middleware. Manages `workspaces[]` in localStorage.

```ts
useWorkspaceStore()
// → { workspaces, createWorkspace(data), clearWorkspaces() }
```

---

## Components (`apps/client/components/`)

### Custom Components

#### `navbar.tsx`

```ts
interface NavbarProps {
  onCreateWorkspace?: () => void
  onMenuClick?: () => void
}
```

#### `sidebar.tsx`

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

Active detection via `usePathname()` — exact match for `/`, `startsWith` for others.

### shadcn/ui Components (`components/ui/` — immutable)

> Never edit these files. Add new components via `npx shadcn@latest add <component>`.

| Category   | Components                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Layout     | `accordion`, `card`, `breadcrumb`, `sheet`, `scroll-area`, `separator`, `sidebar`                                     |
| Forms      | `alert-dialog`, `checkbox`, `command`, `input`, `input-group`, `label`, `radio-group`, `select`, `switch`, `textarea` |
| Navigation | `dropdown-menu`, `navigation-menu`, `tabs`                                                                            |
| Feedback   | `alert`, `badge`, `calendar`, `dialog`, `popover`, `progress`, `skeleton`, `tooltip`, `sonner`                        |
| Data       | `table`, `chart`                                                                                                      |
| Other      | `avatar`, `button`, `slider`                                                                                          |

### Utilities

#### `lib/utils.ts`

```ts
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
    ├── prisma.service.ts       # PrismaClient wrapper
    ├── prisma.module.ts        # @Global() NestJS module
    ├── index.ts                # Package exports
    └── generated/client/       # Prisma Client — DO NOT EDIT
```

### PrismaModule

`@Global()` — import **once** in `AppModule`, then inject `PrismaService` anywhere without re-importing.

### Workflow

```bash
# After any schema.prisma change:
pnpm db:generate      # regenerate Prisma client
pnpm db:migrate:dev   # create migration file + apply

# Multi-step writes — always use transactions:
await prisma.$transaction([...])
```

---

## Coding Style

### Server vs Client Components

```
Default → Server Component (no directive needed)
Needs useState / useEffect / event handlers → add 'use client'
Layouts → NEVER add 'use client' unless absolutely unavoidable
```

### Route Segment Files

Every route segment must have:

```
app/some-route/
├── page.tsx      # Required
├── loading.tsx   # Required
└── error.tsx     # Required
```

### Styling Rules

| Rule                | Detail                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| Colors              | CSS variables only — `bg-primary`, `text-destructive`, `text-muted-foreground` |
| No hex              | Never hardcode `#fff`, `rgb(...)`                                              |
| Conditional classes | Always use `cn()`                                                              |
| Responsive          | Mobile-first: base → `sm:` (640px) → `lg:` (1024px)                            |
| Dark mode           | `dark:` variant or CSS variables (auto via `ThemeProvider`)                    |

### Data Fetching

```
Server data (static/ISR) → Next.js fetch() with revalidation tags
Client server state      → TanStack React Query
Complex client state     → Zustand
Client API calls         → fetchClient() via service layer (services/)
```

### Import Aliases

```ts
'@/'              → apps/client/ root
'@/components/ui' → shadcn components (immutable)
'@/components'    → custom components
'@/lib/utils'     → cn() and utilities
'@/lib/auth'      → NextAuth config
'@/hooks'         → custom hooks
'@/services'      → API service layer
'@/store'         → Zustand stores
'@/types'         → shared TypeScript interfaces
```

### No-Nos

- No `any` or `@ts-ignore` — zero tolerance
- No mock data — always connect to real Prisma/APIs
- Never edit `components/ui/**` — use `npx shadcn@latest add`
- Never skip `pnpm db:migrate:dev` after schema changes
- Never use `NEXT_PUBLIC_BACKEND_URL` — correct var is `NEXT_PUBLIC_API_URL`
