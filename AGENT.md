# AGENT.md — Production-Grade Rules (Next.js 16 & NestJS 11)

This document outlines strict guidelines for any AI agent working in this repository.
Production-Ready system. Quick hacks, hardcoded mock data, and bypassing type safety are strictly prohibited.
Focus: Scalability, Security, Maintainability, Performance.

---

## 1. The Production Mindset (Before You Start)

- **Plan Before Coding:** For any new feature, outline the database schema, API contract (DTOs), and component structure, and get approval before writing code.
- **No Mock Data:** Never use static JSON mock files for business logic. Always connect to the real database (Prisma) or external APIs.
- **Zero Tolerance for `any`:** Type safety is non-negotiable. If you don't know a type, investigate or ask. Do not use `any` or `@ts-ignore`.

---

## 2. Frontend — Next.js 16 (App Router)

### Architecture & Rendering

- **Server Components First:** Default to React Server Components (RSC). Only add `"use client"` when interactivity (hooks, event listeners) is strictly required. Do not place `"use client"` at the top of a layout or page unless absolutely necessary.
- **Data Fetching:** Use Next.js native `fetch` with proper caching/revalidation tags for server data. Use TanStack React Query for client server state.
- **State Management:** Use **Zustand** for complex client state. Avoid global contexts for simple things.
- **Component Size:** If a component is too large or deeply nested, break it into smaller, reusable sub-components.

### HTTP Client

- All API calls go through `fetchClient()` in `lib/fetcher.ts`.
- The base URL is `NEXT_PUBLIC_API_URL` — **never** `NEXT_PUBLIC_BACKEND_URL` (does not exist).
- Wrap `fetchClient` in a service (`services/`) rather than calling it directly from components or hooks.
- All backend routes are versioned: `/api/v1/...`

### Auth

- NextAuth v5 config is at `lib/auth/index.ts`. Exports: `handlers`, `signIn`, `signOut`, `auth`.
- Auth pages live under `app/(auth)/` route group.
- Session provider: `components/providers/session-providers.tsx`.
- Access tokens stored in JWT session only. Never in localStorage.

### UI & Styling (Tailwind v4 & shadcn/ui)

- **Never modify** auto-generated files in `components/ui/**`. Treat as immutable third-party code. Add via `npx shadcn@latest add <component>`.
- Use CSS variables for theming (`bg-primary`, `text-destructive`). Never hardcode hex colors.
- Always use `<Image>` from `next/image` for images, `<Link>` from `next/link` for routing.
- Conditional classes always use `cn()` from `lib/utils.ts`.

### Error Handling & UX

- Implement `error.tsx` and `loading.tsx` for all route segments.
- Use Sonner toast notifications for API error feedback on the client side.

---

## 3. Backend — NestJS 11 (Fastify)

### HTTP Adapter

Backend uses **Fastify** (`NestFastifyApplication`), not Express.

- Plugins registered via `app.register()`, not `app.use()`
- Cookies via `@fastify/cookie`
- CORS via `@fastify/cors`

### API Route Structure

- Global prefix: `api`. URI versioning with `defaultVersion: '1'`. All routes resolve to `/api/v1/...`.
- Every feature module under `src/api/v1/<feature>/` has three sub-layers:
  - `public/` — no auth guard
  - `authorized/` — `JwtAuthGuard` required
  - `admin/` — `JwtAuthGuard` + `RolesGuard` (ADMIN role)

### Layered Architecture (Strict Boundaries)

1. **Controllers:** HTTP routing and DTO validation only. No business logic.
2. **Services:** Core business logic.
3. **Prisma:** Direct database interactions. Services call PrismaService.

### Naming Conventions

- **Controllers:** Class name must end with `Controller` (e.g. `AuthAdminController`, `WorkspaceAuthorizedController`).
- **Services:** Class name must end with `Service` (e.g. `AuthPublicService`, `NodesAuthorizedService`).

### Database & Prisma (PostgreSQL)

- Never write raw SQL for standard operations — use Prisma Client.
- **Migrations are Sacred:** Never manually alter the database schema. Modify `schema.prisma` and run `pnpm db:migrate:dev`.
- **Transactions:** Use `$transaction` for multiple dependent writes (ACID compliance).

### Validation & Serialization

- DTOs use `class-validator` + `class-transformer` + `nestjs-zod`.
- Use `@Type()` for nested objects and arrays.
- Exclude sensitive fields (e.g. passwords) with `@Exclude()`.
- `ValidationPipe` is currently commented out in `main.ts` — add per-controller or re-enable globally.
- Global: `HttpExceptionFilter`, `ClassSerializerInterceptor`.

### Performance & Async Jobs

- If a process takes longer than 500ms (emails, reports, etc.), do not block the HTTP response. Use **BullMQ (Redis)** for background jobs (not yet installed — plan ahead).
- Cache heavy read queries using Redis via NestJS CacheManager.

---

## 4. Security (Zero Trust)

- **Authentication & Authorization:**
  - Use strictly configured `JwtAuthGuard`.
  - RBAC via `RolesGuard` + `@Roles()` decorator.
  - Refresh Tokens in `HttpOnly, Secure, SameSite=Strict` cookies. Access Tokens short-lived, returned in JSON.
- **Input Sanitization:** Guard against XSS and SQL Injection. Trust no user input.
- **Environment Variables:** Never commit `.env` files. Validate all secrets on startup.
- **Rate Limiting:** `@nestjs/throttler` on all public endpoints, especially `/auth`.

---

## 5. Error Handling & Logging

- **No Silent Failures:** Catch and surface exceptions properly.
- **Standardized Responses:** `HttpExceptionFilter` ensures consistent error shape:

  ```json
  {
    "statusCode": 400,
    "message": "Validation failed",
    "error": "Bad Request",
    "timestamp": "2026-05-14T08:26:40Z"
  }
  ```

- **Backend always returns a JSON body** on success — `fetchClient` calls `response.json()` unconditionally.
