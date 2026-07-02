# Development Plan

## Current State

| Area                                                            | Status                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/v1/public/auth/register`                             | ✅ Done                                                                           |
| `POST /api/v1/public/auth/login`                                | ✅ Done — 15m JWT, sets `refresh_token` HttpOnly cookie, logs `AuthLog(LOGIN)`    |
| `POST /api/v1/public/auth/refresh`                              | ✅ Done — rotates refresh token, issues new 15m JWT                               |
| `POST /api/v1/authorized/auth/logout`                           | ✅ Done — deletes all user refresh tokens, clears cookie, logs `AuthLog(LOGOUT)`  |
| NextAuth v5 session (Credentials)                               | ✅ Done — silent refresh in `jwt` callback, 7-day session                         |
| `RefreshToken` schema + service                                 | ✅ Done — opaque 64-byte token, 7-day TTL, rotated on each use                    |
| `AuthLog` schema + service                                      | ✅ Done — LOGIN/LOGOUT logged with IP + userAgent                                 |
| Jotai workspace store (localStorage)                            | ✅ Done                                                                           |
| `Workspace` DB model                                            | ✅ Schema exists, authorized service empty                                        |
| `getProfile`                                                    | ⬜ Commented out                                                                  |
| Workspace API                                                   | ⬜ Not implemented                                                                |
| `apps/python` FastAPI service                                   | ✅ Scaffolded — health check only                                                 |
| PI System ingestion                                             | ⬜ Planned — Phase 6                                                              |
| `SensorReading` time-series model                               | ⬜ Not implemented                                                                |
| Data Processing pipeline (fill/cut/clean/features/split/export) | 🟡 Partial — fill+clean+heatmap done; cut/features/split/export planned (Phase 7) |

---

## Phase 1 — Refresh Token

**Goal:** Issue and rotate refresh tokens so users stay logged in across access token expiry.

### Backend

- **`loginService`** — after issuing access token:
  - Create `RefreshToken` record in DB (`expiresAt` = now + 7 days)
  - Set `HttpOnly; Secure; SameSite=Strict` cookie: `refresh_token=<token>`
  - Log `AuthLog` entry: `action: LOGIN`, `ipAddress`, `userAgent`

- **`POST /api/v1/public/auth/refresh`** (new endpoint)
  - Read `refresh_token` cookie
  - Validate: exists in DB, not expired
  - Rotate: delete old record, create new `RefreshToken`
  - Issue new access token (JWT, 15 min)
  - Set new cookie
  - Returns `{ data: { accessToken } }`

- **`POST /api/v1/authorized/auth/logout`** (new endpoint, JWT-guarded)
  - Delete `RefreshToken` record for current user
  - Clear `refresh_token` cookie
  - Log `AuthLog` entry: `action: LOGOUT`

### Files

```
apps/backend/src/api/v1/auth/public/auth.public.service.ts     — update loginService
apps/backend/src/api/v1/auth/public/auth.public.controller.ts  — add POST /refresh
apps/backend/src/api/v1/auth/public/dto/auth.public.dto.ts     — RefreshResponseDto
apps/backend/src/api/v1/auth/authorized/auth.authorized.service.ts   — add logoutService
apps/backend/src/api/v1/auth/authorized/auth.authorized.controller.ts — add POST /logout
```

---

## Phase 2 — Access Token

**Goal:** Short-lived access tokens (15 min) with silent refresh via NextAuth callbacks.

### Backend

- Change `jwtService.sign` in `loginService`: `expiresIn: '15m'` (currently `'1d'`)
- Ensure `JwtAuthGuard` rejects truly expired tokens (already handled by `@nestjs/passport`)

### Frontend (`apps/client/lib/auth/index.ts`)

- Add `tokenExpiry` to JWT token type (`types/next-auth.d.ts`)
- In `jwt` callback: decode `exp` from access token, store as `token.expiresAt`
- Add silent refresh logic in `jwt` callback:
  ```ts
  if (Date.now() < token.expiresAt - 60_000) return token // still valid
  // call POST /api/v1/public/auth/refresh (cookie sent automatically)
  // update token.accessToken + token.expiresAt
  ```
- On refresh failure: return `{ ...token, error: 'RefreshTokenExpired' }` → middleware redirects to `/login`

### Files

```
apps/client/lib/auth/index.ts         — add refresh logic in jwt callback
apps/client/types/next-auth.d.ts      — add expiresAt, error fields
apps/client/middleware.ts             — redirect on RefreshTokenExpired error
```

---

## Phase 3 — Integration with Auth Module

**Goal:** Complete auth feature set — profile CRUD, password change, OAuth.

### Backend

- **`GET /api/v1/authorized/auth/me`** — return current user profile
  - Uncomment `getProfile` in `auth.authorized.service.ts`
  - Select: `id, email, firstName, lastName, company, role, createdAt`

- **`PATCH /api/v1/authorized/auth/me`** — update profile
  - Fields: `firstName`, `lastName`, `company`
  - Returns updated user

- **`PATCH /api/v1/authorized/auth/me/password`** — change password
  - Validate current password with argon2
  - Hash and update new password
  - Invalidate all existing refresh tokens for user (force re-login)

- **OAuth login** — uncomment `oauthLogin` in `auth.public.service.ts`
  - Restore `POST /api/v1/public/auth/oauth`
  - Issue refresh token + set cookie (same as credentials login)

### Frontend

- **Settings `AccountTab`** — wire `saveAccount` to call `PATCH /api/v1/authorized/auth/me`
- **Password card** — wire to `PATCH /api/v1/authorized/auth/me/password`
- **Session update** — call `update()` from `useSession` after profile patch to refresh session data

### Files

```
apps/backend/src/api/v1/auth/authorized/auth.authorized.service.ts    — getProfile, updateProfile, changePassword
apps/backend/src/api/v1/auth/authorized/auth.authorized.controller.ts — GET /me, PATCH /me, PATCH /me/password
apps/backend/src/api/v1/auth/authorized/dto/auth.authorized.dto.ts    — UpdateProfileDto, ChangePasswordDto
apps/client/app/settings/components/account.tsx                       — call API on save
apps/client/services/auth.service.ts                                  — new service wrappers
```

---

## Phase 4 — Testing and Validation

**Goal:** Reliable, verified auth flow end-to-end.

### Backend

- Enable `ValidationPipe` globally in `main.ts` (currently commented out)
- Unit tests:
  - `registerService` — duplicate email, hash verified
  - `loginService` — wrong password, null password (OAuth user), success
  - `refreshService` — expired token, missing token, rotation
  - `logoutService` — token deleted, cookie cleared
- Integration tests (real Prisma, test DB):
  - Full login → refresh → logout cycle
  - Concurrent refresh (prevent token replay)

### Frontend

- Manual E2E checklist:
  1. Register → auto-login redirects to root
  2. Login → session populated with `firstName`, `lastName`, `role`
  3. Wait 15 min → access token silently refreshed
  4. Logout → cookie cleared, redirected to `/login`
  5. Expired refresh token → redirected to `/login`

### Files

```
apps/backend/src/main.ts                                         — enable ValidationPipe
apps/backend/src/api/v1/auth/public/auth.public.service.spec.ts — unit tests
apps/backend/src/api/v1/auth/authorized/auth.authorized.service.spec.ts
```

---

## Phase 5 — Workspace and User Management Integration

**Goal:** Move workspace state from localStorage (Jotai) to the database.

### Backend

- **`POST /api/v1/authorized/workspace`** — create workspace
  - Owner = JWT `id`
  - Log `WorkspaceLog: CREATED`

- **`GET /api/v1/authorized/workspace`** — list user's workspaces
  - Returns `id, name, icon, color, modelsCount (count of models)`

- **`PATCH /api/v1/authorized/workspace/:id`** — update name/icon/color
  - Ownership check (must be owner)
  - Log `WorkspaceLog: UPDATED`

- **`DELETE /api/v1/authorized/workspace/:id`** — delete workspace
  - Cascade deletes models (schema already has `onDelete: Cascade`)
  - Log `WorkspaceLog: DELETED`

### Frontend

- Replace Jotai `atomWithStorage` (localStorage) with API-backed atom:
  - On mount: fetch `GET /api/v1/authorized/workspace` → populate `workspacesAtom`
  - `createWorkspaceAtom`: call POST API → add returned workspace to atom
  - `WorkspaceTab` save: call PATCH API → update atom
  - Delete: call DELETE API → remove from atom
- Remove `modelsCount: 0` hardcode — read from API response

### Files

```
apps/backend/src/api/v1/workspace/authorized/workspace-authorized.service.ts    — full CRUD
apps/backend/src/api/v1/workspace/authorized/workspace-authorized.controller.ts — routes
apps/backend/src/api/v1/workspace/authorized/dto/workspace.authorized.dto.ts    — DTOs
apps/client/store/auth.ts                                                        — API-backed atoms
apps/client/hooks/use-workspaces.ts                                              — fetch + hydrate on mount
apps/client/app/settings/components/workspace.tsx                               — wire save/delete
apps/client/components/auth/create-workspace-form.tsx                           — call API
```

---

## Phase 6 — PI System Integration (FastAPI Sensor Ingestion)

**Goal:** Ingest live sensor data from a PI System (AVEVA/OSIsoft historian) into Postgres via the `apps/python` FastAPI service, surfaced to the client through NestJS.

**Architecture:** PI Web API (REST/HTTPS) → FastAPI poller (APScheduler) → `SensorReading` table (Postgres) → NestJS read endpoints → Next.js. FastAPI owns ingestion (DML only); NestJS owns serving; Prisma owns schema. The client never calls FastAPI directly.

**Planned Prisma model:**

```prisma
model SensorReading {
  id        String   @id @default(uuid())
  nodeId    String
  node      Nodes    @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  piTag     String
  value     Float
  status    String   // PI value quality: Good | Bad | Questionable
  timestamp DateTime // PI source timestamp (UTC)
  createdAt DateTime @default(now())

  @@index([nodeId, timestamp])
  @@index([piTag, timestamp])
}
```

(plus `readings SensorReading[]` back-relation on `Nodes`, and optional `piTag` added to `NodeDataSchema`.)

### 6.1 Schema (`packages/prisma`)

- Add `SensorReading` model + `Nodes.readings` back-relation.
- Add optional `piTag` to `NodeDataSchema` (backend Zod) so a node maps to a PI point.
- Run `pnpm db:migrate:dev`.

### 6.2 FastAPI — PI Web API client (`apps/python`)

- `clients/pi_web_api.py`: async `httpx` client. Methods: `resolve_webid(tag)`, `get_values(webids)` (batch via `/streamsets/.../value`).
- `config/env.py`: add `PI_WEB_API_BASE_URL`, `PI_WEB_API_USERNAME`, `PI_WEB_API_PASSWORD`, `PI_WEB_API_VERIFY_SSL`, `PI_POLL_INTERVAL_SECONDS`, `DATABASE_URL`.
- Root `.env.example`: add the `PI_*` vars (no secrets).

### 6.3 FastAPI — DB + ingest service

- `db/`: async SQLAlchemy engine/session on shared `DATABASE_URL` (DML only).
- `services/ingest_service.py`: load mapped nodes (`piTag` present) → resolve + cache WebIDs → batch-read → insert `SensorReading` rows.
- `scheduler.py`: APScheduler job every `PI_POLL_INTERVAL_SECONDS`, started in app lifespan.
- `routers/ingest.py`: internal `POST /ingest/run` to trigger a poll manually (guarded by shared secret).
- `requirements.txt`: add `httpx`, `apscheduler`, `sqlalchemy[asyncio]`, `asyncpg`.

### 6.4 Backend — serving endpoints (`apps/backend`)

- `GET /api/v1/authorized/nodes/:nodeId/readings?from&to&limit` — paginated history (reuse pagination convention).
- `GET /api/v1/authorized/nodes/:nodeId/readings/latest` — latest value per node.
- Controller → service → Prisma; errors via `AppException`.

### 6.5 Frontend — wire readings

- `services/readings.ts`: wrappers for the two endpoints.
- Node detail / overview panel: show latest value + sparkline from readings.
- Derive node `status` from latest reading quality where applicable.

### 6.6 Verification

- FastAPI: `pnpm --filter python dev`, hit `POST /ingest/run`, confirm `SensorReading` rows in Postgres.
- Backend: `GET .../readings/latest` returns ingested values.
- Frontend: node panel renders live value.

### Files

```
packages/prisma/prisma/schema.prisma                              — SensorReading model
apps/python/clients/pi_web_api.py                                 — PI Web API client
apps/python/services/ingest_service.py, scheduler.py, db/         — ingest + polling
apps/python/routers/ingest.py, config/env.py                      — trigger + config
apps/backend/src/api/v1/nodes/authorized/{controller,service,dto} — readings endpoints
apps/client/services/readings.ts                                  — service wrappers
.env.example                                                      — PI_* vars
```

---

## Phase 7 — Data Processing Pipeline (Create-Model wizard)

**Goal:** Take the fetched Raw Data (Phase 4) through a full prepare-for-training pipeline — fill, cut, clean, inspect correlation, engineer features, split, and persist/export — before Training. Extends `models/create/` Phase 5 (Processing). All transforms are pure functions over `Dataset` in `lib/` (mirrors `lib/preprocessing.ts` / `lib/data-quality.ts`); UI in route `components/`; state in `store/model-pipeline.ts`. No new deps, no `any`.

**Already done (reuse, don't rebuild):**

- Fill data — per-tag `FillStrategy` (drop/forward/backward/mean/median/constant) + interpolate + smooth: `lib/preprocessing.ts` `preprocess()`, wired in `phase-5-processing.tsx`.
- Clean data / normalize — `preprocess()` (drop Bad, interpolate Questionable) + `toModelReady()` (min-max).
- Correlation heatmap — `lib/data-quality.ts` `pearsonMatrix`/`topCorrelations` + `components/correlation-matrix.tsx`.
- Quality metrics — `qualityByTag`/`datasetQuality`.

### 7.1 Cut / trim data (new — `lib/dataset-transform.ts`)

- `cutByTimeRange(ds, from, to)` — keep rows in an inclusive timestamp window.
- `cutByRowRange(ds, startIdx, endIdx)` — index slice.
- `dropOutliers(ds, tag, method)` — z-score / IQR per tag (mark or remove).
- `resample(ds, intervalMs, agg)` — downsample by mean/last per bucket.

### 7.2 Feature engineering (new — `lib/feature-engineering.ts`)

- `addLag(ds, tag, k)`, `addRolling(ds, tag, window, 'mean'|'std'|'min'|'max')`, `addRatio(ds, a, b)`, `addDelta(ds, tag)`. Each returns a new `Dataset` with added tag columns; column naming e.g. `TI-101__lag3`, `TI-101__roll5_mean`.
- Pure; reuse `Cell`/`DataRow` shapes from `lib/preprocessing.ts`.

### 7.3 Train / test split (new — `lib/dataset-split.ts`)

- `splitDataset(ds, { ratio, method: 'sequential'|'random', seed })` → `{ train, test }` (time-series default = sequential, no shuffle). Optional validation third split.
- `splitStats(split)` — row counts + date spans per partition.

### 7.4 UI — extend the wizard

- Add sub-sections to Phase 5 Processing — Fill (exists) · Cut · Features · Correlation · Split — with a live before/after preview reusing `StepView` (`data-visualize/components/step-view.tsx`) and the debounced-draft pattern already in `phase-5-processing.tsx`.
- New atoms in `store/model-pipeline.ts`: `mpCutConfigAtom`, `mpFeatureConfigsAtom`, `mpSplitConfigAtom`; cascade-relock via `use-model-pipeline-nav.ts` (same `setHighestUnlocked(min, …)` + `resetTraining()` pattern as `setFillStrategies`).

### 7.5 Save in project / export

- **Save in project:** persist the processed, split dataset with the model. Options: (i) a `ProcessedDataset` Prisma model (`modelId`, `stage`, JSON columns/rows or a blob ref) written via a NestJS `authorized/` endpoint; or (ii) store a processing _recipe_ (fill/cut/feature/split configs) on `AIModel.data` JSON so it re-derives deterministically. Recipe-only is lighter and matches the current mock-derivation approach.
- **Export:** client-side CSV/JSON download of `train`/`test` (pure serializer `lib/dataset-export.ts` — `toCsv(ds)` / `toJson(ds)`); optional server export endpoint later.

### 7.6 Verification

- Unit-test the pure libs (Vitest) with a small `Dataset` fixture: cut window row count, lag/rolling column values, split ratios + no leakage (sequential), CSV round-trip.
- Wizard clickthrough: Phase 4 fetch → Phase 5 Cut/Features/Split preview updates live → Export downloads a CSV → advancing to Training uses the split `train` set.

### Files

```
apps/client/lib/dataset-transform.ts       — cut / outliers / resample
apps/client/lib/feature-engineering.ts     — lag / rolling / ratio / delta
apps/client/lib/dataset-split.ts           — train/test/val split + stats
apps/client/lib/dataset-export.ts          — toCsv / toJson serializers
apps/client/app/(default)/models/create/components/pipeline/phase-5-processing.tsx — sub-sections + preview
apps/client/store/model-pipeline.ts        — cut/feature/split config atoms
apps/client/hooks/model/use-model-pipeline-nav.ts — cascade relock on config change
(optional) packages/prisma/prisma/schema.prisma + apps/backend — persist processed dataset/recipe
```

---

## Dependency Order

```
Phase 1 (RefreshToken)
  └─ Phase 2 (AccessToken — needs refresh endpoint from Phase 1)
       └─ Phase 3 (Auth Module — needs stable token lifecycle)
            └─ Phase 4 (Testing — validates Phase 1-3)
                 └─ Phase 5 (Workspace — needs auth + user identity fully working)
                      └─ Phase 6 (PI Integration — needs Workspace/Node CRUD from Phase 5)
                           └─ Phase 7 (Data Processing — needs real readings from Phase 6; UI usable now on mock)
```

## 2. Color Theory & Tokens

Before diving into CSS variables, it is crucial to understand the design principles driving our palette. All tokens are defined in `app/globals.css` under `:root` (light) and `.dark`, and registered in `@theme inline` for native Tailwind support.

### 2.1 The Purpose of Color

Applying strict color theory within the SoftSensor app provides three main benefits:

- **Impactful visual design:** Utilizing contrasting colors to grab the user’s attention, while striking a color balance for enduring visual appeal.
- **Improved UX:** Leveraging color harmony to support user workflows, making it easier to scan content and intuitively navigate the product’s UI.
- **Better brand expression:** Showcasing our brand personality, core messaging, and mood through a calculated, deliberate palette.

### 2.2 The Color Wheel Foundations

Our semantic system and status colors respect the fundamental relationships defined by the traditional color wheel:

- **Primary colors (RYB):** Red, yellow, and blue. When combined, these serve as the base for all other colors in the UI.
- **Secondary colors:** Orange, green, and violet. Formed by mixing two primary colors (e.g., red + yellow = orange).
- **Tertiary colors:** Red-orange, yellow-orange, yellow-green, blue-green, blue-violet, and red-violet. The result of mixing a primary color with a secondary color.

### 2.3 Semantic Tokens

| Token                    | Light                      | Dark                | Usage                         |
| ------------------------ | -------------------------- | ------------------- | ----------------------------- |
| `--background`           | Near-white                 | Very dark           | Page background               |
| `--foreground`           | Dark                       | Near-white          | Body text                     |
| `--card`                 | Pure white                 | Dark charcoal       | Card surfaces                 |
| `--card-foreground`      | Dark                       | Near-white          | Text on cards                 |
| `--popover`              | Pure white                 | Dark charcoal       | Popover/dropdown surfaces     |
| `--primary`              | Blue (oklch 0.55 0.18 250) | Brighter blue (0.6) | CTAs, active states, links    |
| `--primary-foreground`   | White                      | White               | Text on primary bg            |
| `--secondary`            | Light gray                 | Dark gray           | Secondary buttons, chips      |
| `--secondary-foreground` | Dark                       | Light               | Text on secondary             |
| `--muted`                | Very light gray            | Dark gray           | Subtle backgrounds, disabled  |
| `--muted-foreground`     | Medium gray                | Gray                | Placeholder, secondary labels |
| `--accent`               | Subtle gray                | Dark                | Hover highlights              |
| `--accent-foreground`    | Dark                       | Light               | Text on accent                |
| `--destructive`          | Red-orange                 | Darker red          | Errors, delete actions        |
| `--border`               | Light gray                 | Dark gray           | Borders, dividers             |
| `--input`                | Light gray                 | Dark gray           | Input backgrounds             |
| `--ring`                 | Matches primary            | Matches primary     | Focus rings                   |

### 2.4 Chart Tokens

`--chart-1` through `--chart-5` — blue-to-purple spectrum. Used for data visualizations only.

### 2.5 Sidebar Tokens

`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` — mirrors semantic tokens but scoped specifically to the sidebar surface to maintain visual hierarchy.

### 2.6 Usage in Code

```tsx
// Correct — CSS variable-backed class (maintains color harmony & dark mode)
<div className="bg-card text-card-foreground border-border" />

// Wrong — hardcoded color (breaks theory and theme support)
<div className="bg-[#0f1115]" />
```
