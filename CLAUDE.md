# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Every Task

Read [`docs/CODEBASE.md`](docs/CODEBASE.md) before starting any task. It is the authoritative reference for project structure, component APIs, Prisma patterns, and coding style. Do not rely on assumptions — verify against that file first.

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
pnpm --filter backend test -- --testPathPattern=<filename>
```

## Architecture

Turborepo + pnpm monorepo. Two apps, three packages:

```text
apps/backend            # NestJS 11 + Fastify, port 8000 (SERVER_PORT env)
apps/client             # Next.js 15 App Router, port 3000
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
- **Swagger:** available at `/swagger`.

### Database (`packages/prisma`)

- `PrismaModule` is `@Global()` — import it once in `AppModule`, then inject `PrismaService` anywhere without re-importing the module.
- Schema at `packages/prisma/prisma/schema.prisma`; client generated to `packages/prisma/src/generated/client`.
- After any schema change: `pnpm db:generate` then `pnpm db:migrate:dev`.
- Use `prisma.$transaction([...])` for multi-step writes.

### Frontend (`apps/client`)

- **Default to Server Components.** Only add `"use client"` when hooks or event listeners are required. Never put `"use client"` on a layout unless unavoidable.
- **Auth route group:** auth pages live under `app/(auth)/` — login, register, reset-password.
- **Auth config:** `lib/auth/index.ts` — NextAuth v5 config, exports `handlers`, `signIn`, `signOut`, `auth`.
- **`DecodedToken` in `lib/auth/index.ts`:** Fields must be camelCase (`firstName`, `lastName`) matching the JWT payload exactly — mismatched casing silently produces `undefined` session fields.
- **Login response shape:** Backend returns `{ data: { accessToken } }`. `authorize` reads `user.data?.accessToken ?? user.accessToken` to handle both wrapped and flat shapes.
- **Session provider:** `components/providers/session-providers.tsx`.
- **HTTP client:** `lib/fetcher.ts` → `fetchClient()`. Uses `NEXT_PUBLIC_API_URL` as base URL. Never use `NEXT_PUBLIC_BACKEND_URL` (does not exist).
- **Service layer:** `services/` — thin wrappers over `fetchClient`. Always pass full versioned path (`/api/v1/...`).
- **State:** Zustand (`store/`) for complex client state. `useWorkspaceStore` in `store/auth-store.ts`.
- **Data fetching:** Next.js `fetch` with revalidation tags for server data.
- **UI components:** shadcn/ui (style: `radix-nova`) — `components/ui/` files are generated and must not be edited. Add via `npx shadcn@latest add <component>` (config at `components.json`).
- `cn()` utility is at `lib/utils.ts`.
- Tailwind v4 — CSS-first. Use CSS variables (`bg-primary`, `text-destructive`). Never hardcode hex colors.
- Every route segment needs `error.tsx` and `loading.tsx`.
- Toast feedback via Sonner (`components/ui/sonner`, imported in `app/layout.tsx`).
- `ThemeProvider` at `components/providers/theme-provider.tsx`.

## Key constraints from AGENT.md

- **No `any` or `@ts-ignore`** — zero tolerance.
- **No mock data** — always connect to real Prisma/APIs.
- **Plan first** — for any new feature, outline schema + API contract + component structure before coding.
- Never modify `schema.prisma` by hand and skip migrations — always `migrate dev`.
- `components/ui/**` are immutable — never edit generated shadcn files.
- **Env vars:** `NEXT_PUBLIC_API_URL` is the backend base URL — never use `NEXT_PUBLIC_BACKEND_URL`.
