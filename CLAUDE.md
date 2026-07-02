# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before Every Task

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system design, layer model, auth flow, and key architectural decisions. Read [`docs/CODEBASE.md`](docs/CODEBASE.md) for project structure, component APIs, Prisma patterns, and coding style. For any frontend/UI work, read [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) for color tokens, status color conventions, component patterns, and design rules. Do not rely on assumptions — verify against these files first.

For any UI/design/product work, also read [`PRODUCT.md`](PRODUCT.md) (register, users, brand personality, anti-references, design principles) and [`DESIGN.md`](DESIGN.md) (color tokens, typography scale, elevation rules, component specs, do's and don'ts). DESIGN.md wins on visual decisions; PRODUCT.md wins on strategic/voice decisions.

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

# Python / PI connector (apps/python) — uses .venv
cd apps/python && python -m venv .venv && .venv/bin/pip install -r requirements.txt   # first-time setup
pnpm --filter python dev     # uvicorn --reload, port 8000
pnpm --filter python start   # production uvicorn

# Single backend test
pnpm --filter backend test -- --testPathPatterns=<filename>   # Jest 30: plural

# Client tests (Vitest)
pnpm --filter client test          # run once
pnpm --filter client test:ui       # interactive Vitest UI

# All tests (root)
pnpm test                          # runs via Turborepo + dotenvx
```

## Architecture

Turborepo + pnpm monorepo. Three apps, three packages:

```text
apps/backend            # NestJS 11 + Fastify, port 4000 (SERVER_PORT env)
apps/client             # Next.js 16 App Router, port 3000
apps/python             # FastAPI PI connector, port 8000 (sensor ingestion)
packages/prisma         # @softsensor/prisma — shared PrismaService/PrismaModule
packages/eslint-config  # shared ESLint config
packages/typescript-config # shared tsconfig bases
```

### Hooks (`.claude/hooks/`)

- PostToolUse on every Write/Edit: runs prettier → ESLint --fix → tsc --noEmit automatically.
- After any Edit, if you need to Edit the same file again, re-Read first — the formatter may have changed indentation/spacing and old_string will no longer match.
- PreToolUse blocks any write to `packages/prisma/src/generated/**` — edit `schema.prisma` instead.
- Backend ESLint config is `eslint.config.mjs` (not `.js`) — NestJS is CommonJS; `.js` with ES imports triggers `MODULE_TYPELESS_PACKAGE_JSON` warning.
- **GateGuard (PreToolUse on Write/Edit):** Before any file write/edit, present these four facts or the tool call is blocked: (1) all files that import this file (`grep`), (2) public functions/classes affected, (3) any data file fields/structure if applicable, (4) user's instruction verbatim. Present facts inline, then retry the same tool call.

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
- **`SensorReading` model (planned, Phase 6):** time-series rows ingested by `apps/python` from PI. Written by FastAPI (DML only), read by NestJS. Indexed on `(nodeId, timestamp)`. Defined/migrated via Prisma only — never DDL from Python.

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
- **Alert count hook:** `hooks/workspace/use-alert-count.ts` → `useAlertCount()` — sums `alarmCount` from `workspacesAtom` **plus** `failedDeploys(models).length` from `useAllModels()`. Badge count matches the `/alerts` page row count (nodes + failed deploys).
- **Live model refresh:** `store/workspace.ts` `modelsRefreshAtom` is a shared invalidation signal. `useAllModels()` refetches when it bumps; `hooks/use-all-models.ts` exports `useRefreshModels()`. Every deploy-state mutation must call it after `updateModel(..., { deployStatus })` so the sidebar dot + Alerts badge auto-update — wired in `use-model-retrain.ts`, `models/[id]/page.tsx`, `models/views/page.tsx`. Add the bump to any new deploy mutation site.
- **Workspace dot folds failed deploys:** a failed model deploy turns the **workspace** indicator red/Abnormal everywhere — sidebar (`use-sidebar` exposes `failedByWorkspace` via `failedCountByWorkspace()` in `lib/model-status.ts`; `sidebar-workspace` dot red when `ws.status !== 'normal' || failed > 0`), workspace cards, admin list, and overview. Backend `ws.status` (`deriveNodeSummary`) stays node-only — the model fold is frontend display. (Supersedes the old "sidebar badge counts node alarms only / no model fan-out" note.)
- **Alerts page:** `(default)/alerts/` — lists non-normal **nodes** (`getNodes()` from `services/canvas`) **plus failed model deploys** (`failedDeploys()` from `lib/model-status` over `useAllModels()`), shown as **"Deploy Failed"** rows linking to `/models/<id>`.
- **Failed deploys on Overview:** `overview-detail-panel.tsx` folds `failedDeploys(models).length` into the plant's `worstStatus` (a failed deploy alone → `warning`) and renders an amber "N model deploy(s) failed" callout. Single source of truth for failed-deploy detection is `failedDeploys()` in `lib/model-status.ts` — never inline the `deployStatus === 'error'` filter. UI label is **"Failed"**; never use the string `'failed'` for the wire value.
- **Laws of UX:** For nav/sidebar/layout work, apply principles from `docs/DESIGN_SYSTEM.md` §12. Minimum: Von Restorff (errors visually distinct), Serial Position (Alerts near top of nav), Fitts's Law (1 click to common actions).
- **Canvas store:** `store/canvas.ts` — `isBuildModeAtom` (toggle build/view mode), `canvasActionsAtom` (delete callbacks), `useCanvasContext()` hook for canvas component tree. Import `useCanvasContext()` instead of reading atoms directly inside canvas components.
- **Isometric lib:** `lib/isomatric.ts` — `ZoneItem`, `MappedNode`, `GRID_SPACING`. Used by dashboard `IsometricMap` for 2.5D coordinate projection. Import `CanvasNode` from `services/canvas.ts` as the node type.
- **Dashboard (digital twin):** `(default)/dashboard/` — 2.5D isometric command-center view. Machine SVGs live under `components/machines/` (cnc-machine, controller, conveyor, robot-arm, sensor). `hooks/use-dashboard-data.ts` fetches all workspace nodes in parallel via `Promise.all`.
- **`types/models.ts`:** Exports mock data generators (`allWorkspaces`, `allModels`, `generateMockModels()`) — placeholder only for `/models` page until real models API is built. Do not reference or extend this pattern; connect new endpoints to real Prisma.
- **Subscription services:** `services/plan.ts` → `planService.listPlans()`, `mySubscription()`, `downgrade()`. `hooks/workspace/use-workspace-plans.ts` — CRUD for `WorkspacePlan` sub-plans within a canvas.
- **Business logic split rule (enforced):** Page components must be thin composition shells only. Data fetching → `hooks/`. Pure derivations → `lib/`. UI sections → route `components/` folder. Never put fetch logic or derive counts/verdicts inside a page component. Pattern: `hooks/use-all-models.ts` + `lib/model-status.ts` + `models/deployed/components/` + `models/deployed/page.tsx`.
- **`AIModel.data.deployStatus` enum:** `'stopped' | 'running' | 'error' | 'initializing'`. Wire value is `'error'` — UI label is "Failed". Never use `'failed'` in code; that string does not exist in the backend Zod enum.
- **`lib/model-status.ts`:** Single source of truth for model status derivations. Exports: `effectiveProdStatus(m)` (stopped/error deploy forces `'offline'`), `deployCounts(models)`, `deployVerdict(models)` (severity: error > initializing > stopped > all-running > empty). Extend this file for new model status logic — do not duplicate in page or component files.
- **`hooks/use-all-models.ts`:** `useAllModels()` — cross-workspace fan-out via `Promise.all(workspaces.map(ws => getModels(ws.id)))`. Returns `ModelWithWorkspace[]` (AIModel + `workspaceName`). Use for any page needing models from all workspaces.
- **Deploy/Monitoring state dependency:** Stopped or error deploy forces monitoring to `'offline'`. Always use `effectiveProdStatus(m)` from `lib/model-status.ts` — never read `m.data?.prodStatus` directly in UI.
- **Workspace members route:** `(default)/workspaces/[id]/members/` — `WorkspaceMembers` component lives at `workspaces/[id]/components/workspace-members.tsx` (workspace domain), not under `settings/components/`.
- **`NodeStatus` canonical type:** Defined once in `store/status-colors.ts` — `'normal' | 'warning' | 'alarm' | 'offline'`. Re-exported from `lib/overview-status.ts` for backward compat. Always import from `@/store/status-colors` in new code. Never redefine locally.
- **`lib/overview-status.ts`:** Pure status derivation for the overview map. Exports: `NodeStatus` (re-export), `STATUS_META`, `deriveStatus(nodes)`, `countNodesByStatus(nodes)`, `deriveSystemStatus(nodesByWorkspace)`. Extend here for new overview status logic — do not duplicate.
- **`hooks/canvas/use-map-viewport.ts`:** SVG pan/zoom/drag mechanics hook. Signature: `useMapViewport(vbCX: number, vbCY: number)`. Returns `{ pan, zoom, isDragging, hoveredId, setHoveredId, hoverPos, containerRef, svgRef, groupTransform, handleTowerLeave, zoomIn, zoomOut, resetView, svgHandlers }`. Used exclusively by `overview-map.tsx` — do not duplicate pan/zoom state in new SVG map components, use this hook instead.
- **`hooks/model/use-model-hierarchy.ts`:** Fan-out hook fetching plants + nodes for every workspace in parallel. Returns `{ plantsByWorkspaceId, nodesByWorkspaceId, loading, isFetching, error, refetch }`. Used by `models/views/page.tsx` to drive the Workspace → Plant → Equipment accordion.
- **`lib/mock-readings.ts` + `lib/preprocessing.ts`:** Approved mock-data exception (Phase 6 placeholder, same pattern as `types/models.ts`). `mock-readings.ts` generates deterministic `SensorReading[]` (shape mirrors the planned Prisma model) keyed by `(piTag, timestamp)` — no flicker on re-render/range switch. `preprocessing.ts` is pure (no React/IO): builds wide `Dataset` (rows × tag columns), runs Raw → Preprocessing → Model-Ready stages + OLS regression, and exports `FillStrategy` (`drop | forward | backward | mean | median | constant`) + `FillStrategyConfig` for per-tag fill rules (`drop` is row-level, the rest are cell-level; untagged tags keep the legacy drop-Bad/interpolate-Questionable fallback). Consumed by `hooks/use-sensor-readings.ts` (chart/KPI data) and the `data-visualize/` wizard steps (Raw/Processing/Export). Swap path: replace `generateReadings` calls in `use-sensor-readings.ts` with a `services/readings.ts` `fetchClient` call returning the same `SensorReading[]` — one-file change. Do not extend this mock pattern elsewhere; it exists only because Phase 6 ingestion isn't live yet.
- **`lib/mock-pi-servers.ts`:** Second approved mock-data exception, same Phase 6 placeholder pattern as `mock-readings.ts`. Exports `PiServer { id, name, host, status: 'online' | 'offline' }`, `MOCK_PI_SERVERS` (single entry), `getDefaultPiServer()`. Backs wizard Step 2 only — a real PI server list/health-check API is out of scope until ingestion (`apps/python`) is live.
- **`store/data-visualize.ts`:** Jotai atoms driving the `data-visualize/` wizard — `workspaceIdAtom`, `plantIdAtom`, `piServerIdAtom`, `selectedTagsAtom`, `timeRangeAtom`, `fetchStateAtom` (`{ status: 'idle'|'fetching'|'done'|'error', progress, error? }`), `rawDatasetAtom`, `fillStrategiesAtom` (`Record<tag, FillStrategyConfig>`), `currentStepAtom`, `highestUnlockedAtom`, `selectedModelIdAtom`. Also exports `TOTAL_WIZARD_STEPS = 7`. No derived atom stores the preprocessed/model-ready dataset — those are recomputed via `preprocess`/`toModelReady` from `lib/preprocessing.ts` inside the step components that need them.
- **`hooks/use-wizard-navigation.ts`:** Owns wizard step gating + cascade invalidation. `canAdvance(step)` gates 1→7; `goTo`/`next`/`back` clamp to `[1, TOTAL_WIZARD_STEPS]` and `highestUnlocked`. Wrapped setters (`setWorkspaceId`, `setPlantId`, `setSelectedTags`, `setTimeRange`) cascade-reset downstream atoms on change — `setSelectedTags` prunes (not clears) `fillStrategiesAtom` to keys still selected; `setTimeRange` leaves `fillStrategiesAtom` untouched (tag set is unchanged, only the dataset/fetch status reset) so a tag's fill rule survives a range change. Use this hook's setters for any new wizard-state write; do not write `data-visualize.ts` atoms directly from step components.
- **`hooks/use-dataset-fetch.ts`:** Simulates the Step 4 "fetching" stage — fake progress over a fixed step count/interval, then builds the dataset from `lib/mock-readings.ts` and writes `rawDatasetAtom` + `fetchStateAtom`. Replace the internal `setInterval` + mock build with a real fetch when ingestion ships; the `{ status, progress, start, retry }` return shape should stay the same so step components don't change.
- **`(default)/data-visualize/`:** 7-step linear wizard (Workspace&Plant → PI Server → Tags&TimeRange → Fetching → Raw Data → Processing → Export) — `wizard-shell.tsx` switches on `currentStepAtom` to render `step-1..7-*.tsx`, with `wizard-step-indicator.tsx` + `sticky-action-bar.tsx` for nav. Strictly linear: steps 5-7 are not freely tab-switchable, only reachable via `highestUnlockedAtom`. Driven by `store/data-visualize.ts` + `use-wizard-navigation`/`use-dataset-fetch` (mock-backed per above). Steps 5 and 7 reuse `step-view.tsx` for dataset display; step 6 owns the per-tag `FillStrategy` controls with a ~300ms debounced live preview.
- **Create Model wizard ≠ data-visualize wizard.** `(default)/models/create/` is a SEPARATE 7-phase pipeline using `phase-N` naming (`components/pipeline/phase-1..7-*.tsx`, e.g. `phase-4-raw-data.tsx`), driven by `store/model-pipeline.ts` (`mp*` atoms), `hooks/model/use-model-pipeline-nav.ts` (gating: `canAdvance(4)` needs fetch done + rows>0), `use-model-dataset-fetch.ts`. Do NOT confuse with the `data-visualize/` `step-N` wizard. Both reuse `lib/preprocessing.ts` + `lib/mock-readings.ts`. Phase-3 tag catalog is `hooks/model/use-unified-tag-table.ts` (`SOURCE_MOCK_TAGS`); Phase-4 per-source config is `components/source-configs/` (`configFromSource()` prefills from the saved source).
- **`resolveTagMeta(piTag)` in `lib/mock-readings.ts`:** returns real static meta or a deterministic synthetic profile. The Phase-3 catalog surfaces many tag names beyond the 4 static `MOCK_PI_TAGS`; `generateReadings` synthesizes a series for unknown tags (never returns `[]`) so fetched datasets aren't empty. Use `resolveTagMeta`, not `tagMeta`, anywhere a tag may not be one of the 4 statics.
- **recharts arbitrary column keys:** for series keyed by tag names that may contain `.` (e.g. `CMP-001.speed`), pass a function `dataKey={(row)=>row[tag]}` (a literal string with `.` is read as a nested path) and set color explicitly to `var(--chart-N)` — never `var(--color-<tag>)` (invalid CSS custom-property name for dotted keys).
- **`lib/data-quality.ts`:** pure pre-cleansing metrics over a `Dataset` — `qualityByTag`/`datasetQuality` (Missing = `Bad`, Suspect = `Questionable`) + `pearsonMatrix`/`topCorrelations(threshold=0.8)`. Single source for the Phase-4 Data-Quality panel + correlation matrix; extend here, don't inline.
- **`app/payment/`:** Standalone route (outside `(default)/`) for simulated checkout — `billing-form.tsx` + `checkout-summary.tsx`. `hooks/user/use-checkout.ts` calls real `planService.subscribeToPlan()` (no real charge/payment provider wired yet); on success redirects to `/settings?tab=plans`.

### Python / PI Connector (`apps/python`)

FastAPI microservice (port 8000) — ingests sensor data from a PI System (AVEVA/OSIsoft historian) into Postgres. Health-check stub today; ingestion is planned (see `docs/PLAN.md` Phase 6).

- **App factory:** `main.py` → `create_app()` (CORS from `config/env.py` `settings`). Routers registered via `app.include_router(...)`.
- **Config:** `config/env.py` — Pydantic `BaseSettings`, loads `.env`. All PI creds are `PI_*` env vars, server-side only (never `NEXT_PUBLIC_`).
- **PI access:** PI Web API (REST/HTTPS) via async `httpx`. Client wrapper in `clients/pi_web_api.py`. Resolve `piTag → WebID` once and cache; batch-read with `/streamsets/{...}/value`.
- **Ingestion:** APScheduler background job polls mapped PI tags every `PI_POLL_INTERVAL_SECONDS` and writes `SensorReading` rows. Started in the app lifespan, never on import.
- **DB access:** async SQLAlchemy / `asyncpg` against the shared `DATABASE_URL`. DML only — never DDL. Schema is owned by Prisma; change it with `pnpm db:migrate:dev`, then mirror reads/writes in Python.
- **Node ↔ PI mapping:** a node maps to a PI point via optional `piTag` in the `NodeData` JSON (`services/canvas.ts` shape). Unmapped nodes are skipped.
- **Boundary:** FastAPI only ingests + exposes internal health/trigger endpoints. The Next.js client never calls FastAPI directly — it reads sensor history through NestJS authorized endpoints.
- **Structure:** `clients/` (PI Web API), `services/` (ingest logic), `routers/` (health, internal ingest trigger), `schemas/` (Pydantic models), `db/` (engine + session). Mirror NestJS layering: router → service → db.

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
