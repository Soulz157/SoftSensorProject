# SoftSensor — Architecture

## System Overview

SoftSensor is a smart monitoring platform for industrial soft sensor management and AI model analytics. It is a full-stack TypeScript monorepo with a NestJS API and a Next.js frontend.

```
Browser
  └─▶ Next.js (port 3000)
        └─▶ NestJS / Fastify (port 8000)
              └─▶ PostgreSQL (via Prisma)
```

---

## Backend Architecture (`apps/backend`)

### Layer Model

Strict three-layer separation — no business logic leaks across boundaries.

```
HTTP Request
  └─▶ Controller     — route declaration, DTO validation, no logic
        └─▶ Service  — all business logic, orchestration
              └─▶ PrismaService  — database queries only
```

Every layer communicates only with the layer directly below it. Controllers never call PrismaService directly.

### Naming Conventions

| Class type | Suffix       | Example                  |
| ---------- | ------------ | ------------------------ |
| Controller | `Controller` | `AuthAdminController`    |
| Service    | `Service`    | `NodesAuthorizedService` |

### Module Layout

Each feature lives under `src/api/v1/<feature>/` and is split into access tiers:

```
src/api/v1/<feature>/
├── <feature>.module.ts
├── public/           # No auth — open endpoints
│   ├── <feature>.public.controller.ts
│   ├── <feature>.public.service.ts
│   └── dto/
├── authorized/       # JwtAuthGuard required
│   ├── <feature>.authorized.controller.ts
│   ├── <feature>.authorized.service.ts
│   └── dto/
└── admin/            # JwtAuthGuard + RolesGuard (ADMIN)
    ├── <feature>.admin.controller.ts
    ├── <feature>.admin.service.ts
    └── dto/
```

Not every feature needs all three tiers — create only what is needed.

### HTTP Adapter

Fastify (`NestFastifyApplication`), not Express.

- Plugins via `app.register()` — never `app.use()`
- Request/response types: `FastifyRequest` / `FastifyReply`
- CORS restricted via `CORS_ORIGINS` env (comma-separated)

### Auth Flow

```
POST /api/v1/public/auth/login
  ├─▶ verify argon2 password
  ├─▶ sign 15-min JWT (payload: id, email, firstName, lastName, company, role)
  ├─▶ generate 128-char hex refresh token → stored in RefreshToken table
  ├─▶ set HttpOnly refresh_token cookie (7 d)
  └─▶ return { data: { accessToken } }

POST /api/v1/public/auth/refresh
  ├─▶ read refresh_token cookie
  ├─▶ validate token in DB
  ├─▶ rotate: delete old, issue new refresh token
  └─▶ return new accessToken

POST /api/v1/authorized/auth/logout
  ├─▶ delete all RefreshToken rows for user
  ├─▶ write AuthLog LOGOUT entry
  └─▶ clear cookie
```

Token issuance canonical block: `apps/backend/src/api/v1/auth/public/auth.public.service.ts:100-127`.

### Error Convention

Always throw `AppException` from `@softsensor/common`. Never use NestJS built-ins (`BadRequestException`, etc.).

```ts
throw new AppException({ statusCode: 404, message: 'Not found', type: 'ERROR' })
```

### Pagination Pattern

Admin list endpoints use a shared Zod pagination schema extended with optional filters. Service returns `{ items, total, page, limit }` wrapped in the standard envelope. Canonical: `auth/admin/auth.admin.service.ts`.

---

## Frontend Architecture (`apps/client`)

### Rendering Strategy

Default to React Server Components (RSC). Only add `"use client"` when hooks or event listeners are required. Never add `"use client"` to layouts unless unavoidable — layout role gates must run server-side.

```
Server Component (default)
  → no directive, runs on server, no hooks
Client Component
  → 'use client' directive, runs in browser, can use hooks
```

### Route Groups

```
app/
├── (auth)/          # Login, register, reset-password — no nested layout
├── (default)/       # Main app — workspace list, canvas, settings
└── admin/           # ADMIN-only — layout.tsx enforces role gate server-side
```

### Data Flow

```
Server Component → fetch() with revalidation tags (static/ISR data)
Client Component → fetchClient() via service layer → API
Client State     → Jotai atoms (store/)
```

All API calls route through `fetchClient()` in `lib/fetcher.ts`. Never call fetch directly from components or hooks — always wrap in a service (`services/`).

### HTTP Client (`lib/fetcher.ts`)

- Base URL: `NEXT_PUBLIC_API_URL` (never `NEXT_PUBLIC_BACKEND_URL`)
- Injects `Authorization: Bearer <accessToken>` from session
- On 401: calls `signOut()` and throws
- Returns `response.json()` unconditionally

### Auth (NextAuth v5)

```
authorize()
  └─▶ POST /api/v1/public/auth/login
        ├─▶ parse refresh_token from Set-Cookie header
        └─▶ store in encrypted JWT (token.refreshToken)

jwt() callback
  ├─▶ if token valid → return unchanged
  └─▶ if expired → POST /api/v1/public/auth/refresh
        ├─▶ update token.accessToken, token.refreshToken, token.expiresAt
        └─▶ on failure → token.error = 'RefreshTokenExpired'

middleware (proxy.ts)
  └─▶ redirect to /login on unauthenticated or RefreshTokenExpired
```

Config: `lib/auth/index.ts`. Session fields: `id`, `email`, `role`, `accessToken`, `firstName`, `lastName`.

### State Management

Jotai atoms in `store/`. `workspacesAtom` is persisted to localStorage via `atomWithStorage`.

```ts
const workspaces = useAtomValue(workspacesAtom)
const createWorkspace = useSetAtom(createWorkspaceAtom)
const clearWorkspaces = useSetAtom(clearWorkspacesAtom)
```

### Component Rules

- `components/ui/**` — generated by shadcn/ui, **immutable**, add via `npx shadcn@latest add`
- Custom components: `components/` — break large components into sub-components
- `cn()` from `lib/utils.ts` for all conditional Tailwind classes
- Colors: CSS variables only (`bg-primary`, `text-destructive`) — no hardcoded hex

### Route Segment Requirements

Every route segment must have `page.tsx`, `loading.tsx`, and `error.tsx`.

### Providers

`AppProviders` lives in root `app/layout.tsx` only. Never add `SessionProvider` inside segment layouts.

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

---

## Database (`packages/prisma`)

Shared `@Global()` PrismaModule — import once in `AppModule`, inject `PrismaService` anywhere.

Schema: `packages/prisma/prisma/schema.prisma`. Never edit generated files under `src/generated/`.

After any schema change: `pnpm db:migrate:dev` (creates migration + regenerates client).

Use `prisma.$transaction([...])` for all multi-step writes.

### Core Models

| Model          | Purpose                                                         |
| -------------- | --------------------------------------------------------------- |
| `User`         | Auth identity — email, argon2 password, role (USER/STAFF/ADMIN) |
| `Account`      | OAuth provider links                                            |
| `Workspace`    | User workspaces with icon + color                               |
| `Model`        | ML models inside a workspace                                    |
| `RefreshToken` | Active refresh tokens (rotated on each use)                     |
| `AuthLog`      | Login/logout audit trail                                        |
| `WorkspaceLog` | Workspace CRUD audit trail                                      |

---

## Object Storage Retention (MODEL-SERVE-007)

One MinIO bucket (`S3_BUCKET`, `datasets` locally). Every object written by
`apps/python` carries an object tag `retention=<class>`, set from its key by
`class_for_key` (`apps/python/intergrations/object_store.py`, mirrored as
`classForKey` in `apps/backend/src/lib/artifact-keys.ts`).

| Class        | What                                                                     | Can tooling enforce it?                        |
| ------------ | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `sweepable`  | Dataset artifacts and drafts, `tmp/`, feature presets, batch predictions | **Yes** — a tag-filtered lifecycle rule        |
| `permanent`  | `inference/` window records, `serving-logs/`                             | **Yes** — by the ABSENCE of any matching rule  |
| `referenced` | Model run outputs (`models/…`, `drafts/{id}/runs/{id}/…`)                | **NO. Not expressible as any lifecycle rule.** |

**`referenced` is the one that is not enforced by storage.** "Still referenced"
is a reference check, and a bucket lifecycle rule cannot perform one — only
application-level cleanup is authoritative for it (`ArtifactCleanupService`,
plus MODEL-FLOW-011-T05's run-level guard). The tag is a label for humans and
audits. A lifecycle rule written against it would delete on schedule, reference
or no reference. This limit is recorded rather than papered over: a retention
scheme that merely looks fully enforced is more dangerous than one that admits
where it is not.

Existing tag-filtered rule: `ds-lake-009b-tmp-expiry` expires objects tagged
`lifecycle=tmp` after 7 days. That tag is separate from and narrower than
`retention=sweepable`; `tag_retention` refuses tmp keys so it can never
overwrite it.

### Operational notes

- **Objects written before this feature are untagged** and no tag-filtered rule
  reaches them. Intentional — it fails in the safe direction (nothing is
  reclaimed by surprise). There was no backfill.
- **There are three write paths, not one.** `put_object_stream` (covering
  `put_frame` / `put_object_bytes`) and `put_json` tag at write time;
  `copy_prefix` mints objects with `copy_object`, which carries the SOURCE's
  tags, so it tags from the DESTINATION key instead — a copy out of `drafts/`
  into a dataset's own namespace is a root change and therefore possibly a
  class change.
- **Presigned uploads cannot be tagged at write time.** Trainer run outputs,
  batch prediction outputs and an inference window's `predictions.parquet` are
  PUT straight to MinIO by a container. They get their class from
  `store.tag_retention(key)` on the first server-side touch afterwards, in
  `artifact_service.presign_run_object` / `presign_prediction_job_object` /
  `presign_inference_window_object`. Remove those calls and those objects go
  permanently untagged.
- **Bucket creation is manual.** `ensure_bucket()` has no runtime caller and
  MinIO is not in `docker-compose`; the local instance (`minio-local`, ports
  9000/9001) was created by hand.
- **`S3_BUCKET_MODEL` in `.env` is unused.** No code reads it, and the `models`
  bucket it names is empty — every model run output lives under `models/` or
  `drafts/` inside `S3_BUCKET`. Delete it or give it a caller; leaving it is how
  the next reader concludes the store is split when it is not.
- **Trainer image changes need a manual rebuild.** Nothing in CI builds
  `images/trainer`, so `run_manifest.json`'s new `gold_bucket` /
  `gold_artifact_id` fields do not appear until the image is rebuilt and its tag
  bumped.

---

## Key Architectural Decisions

| Decision       | Choice                                       | Reason                                                |
| -------------- | -------------------------------------------- | ----------------------------------------------------- |
| HTTP adapter   | Fastify over Express                         | Performance; plugin API more explicit                 |
| Token storage  | HttpOnly cookie for refresh, JSON for access | XSS cannot read HttpOnly cookies                      |
| Monorepo tool  | Turborepo + pnpm                             | Shared Prisma package; parallel task pipelines        |
| Client state   | Jotai over Zustand                           | Atomic model fits workspace selector pattern          |
| Styling        | Tailwind v4 CSS-first                        | CSS variables for theming; no runtime style injection |
| Error throwing | `AppException` only                          | Consistent error envelope across all features         |
