# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Every Task

Read [`docs/CODEBASE.md`](docs/CODEBASE.md) before starting any task. It is the authoritative reference for project structure, component APIs, Prisma patterns, and coding style. Do not rely on assumptions — verify against that file first.

## Commands

```bash
# Dev (loads root .env via dotenvx, runs all apps concurrently)
pnpm dev

# Build all
pnpm build

# Lint all
pnpm lint

# Type-check all
pnpm type-check

# Database
pnpm db:generate          # regenerate Prisma client after schema changes
pnpm db:migrate           # run prisma migrate dev (loads .env via dotenvx)

# Per-app (when you only need one)
pnpm --filter frontend dev
pnpm --filter backend dev
pnpm --filter backend lint
pnpm --filter frontend lint

# Single backend test
pnpm --filter backend test -- --testPathPattern=<filename>
```

## Architecture

Turborepo + pnpm monorepo. Two apps, two packages:

```
apps/backend      # NestJS 10, port 3001
apps/frontend     # Next.js 15 App Router, port 3000
packages/database # @repo/database — shared PrismaService/PrismaModule
packages/common   # @repo/types — shared API response types (dir name ≠ package name)
```

### Hooks (`.claude/hooks/`)

- PostToolUse on every Write/Edit: runs prettier → ESLint --fix → tsc --noEmit automatically.
- PreToolUse blocks any write to `packages/database/src/generated/**` — edit `schema.prisma` instead.
- Backend ESLint config is `eslint.config.mjs` (not `.js`) — NestJS is CommonJS; `.js` with ES imports triggers `MODULE_TYPELESS_PACKAGE_JSON` warning.

### Backend (`apps/backend`)

Strict layered architecture — Controllers → Services → Prisma. No business logic in controllers.

- **Entry:** `src/main.ts` — global `ValidationPipe` (whitelist + transform), `HttpExceptionFilter`, `ClassSerializerInterceptor`, CORS from `CORS_ORIGIN` env
- **Module pattern:** feature modules under `src/` — each has a controller, service, and DTOs folder
- **DTOs:** validated with `class-validator` + `class-transformer`. Use `@Exclude()` on sensitive fields, `@Type()` on nested objects.
- **Long-running work:** use BullMQ (Redis) — never block HTTP for operations >500ms
- **Auth:** `JwtAuthGuard` + `RolesGuard`. Refresh tokens in `HttpOnly` cookies only.

### Database (`packages/database`)

- `PrismaModule` is `@Global()` — import it once in `AppModule`, then inject `PrismaService` anywhere without re-importing the module.
- Schema at `prisma/schema.prisma`; client generated to `src/generated/client`.
- After any schema change: `pnpm db:generate` then `pnpm db:migrate`.
- Use `prisma.$transaction([...])` for multi-step writes.

### Frontend (`apps/frontend`)

- **Default to Server Components.** Only add `"use client"` when hooks or event listeners are required. Never put `"use client"` on a layout unless unavoidable.
- **Data fetching:** Next.js `fetch` with revalidation tags for server data; TanStack React Query (staleTime 60s, configured in `app/providers.tsx`) for client-side server state.
- **State:** Zustand for complex client state, React Query for server state.
- `next.config.ts` has `output: 'standalone'` and `reactCompiler: true` (`babel-plugin-react-compiler` devDep).
- **UI components:** shadcn/ui — `src/components/ui/` files are generated and must not be edited. Add new components via `npx shadcn add <component>` (config at `components.json`).
- `cn()` utility is at `src/lib/utils.ts`.
- Tailwind v4 — CSS-first. Use CSS variables (`bg-primary`, `text-destructive`). Never hardcode hex colors.
- Every route segment needs `error.tsx` and `loading.tsx`.
- Toast feedback via Sonner (configured in `app/layout.tsx`).

### Shared types (`packages/common`)

`@repo/types` (dir: `packages/common/`) exports `ApiResponse<T>`, `PaginatedResponse<T>`, `ApiErrorResponse`. Use these for all API contracts between backend and frontend.

## Key constraints from AGENT.md

- **No `any` or `@ts-ignore`** — zero tolerance.
- **No mock data** — always connect to real Prisma/APIs.
- **Plan first** — for any new feature, outline schema + API contract + component structure before coding.
- Never modify `schema.prisma` by hand and skip migrations — always `migrate dev`.
- `components/ui/**` are immutable — never edit generated shadcn files.
