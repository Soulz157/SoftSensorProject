# Development Plan

## Current State

| Area                                  | Status                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/v1/public/auth/register`   | ✅ Done                                                                          |
| `POST /api/v1/public/auth/login`      | ✅ Done — 15m JWT, sets `refresh_token` HttpOnly cookie, logs `AuthLog(LOGIN)`   |
| `POST /api/v1/public/auth/refresh`    | ✅ Done — rotates refresh token, issues new 15m JWT                              |
| `POST /api/v1/authorized/auth/logout` | ✅ Done — deletes all user refresh tokens, clears cookie, logs `AuthLog(LOGOUT)` |
| NextAuth v5 session (Credentials)     | ✅ Done — silent refresh in `jwt` callback, 7-day session                        |
| `RefreshToken` schema + service       | ✅ Done — opaque 64-byte token, 7-day TTL, rotated on each use                   |
| `AuthLog` schema + service            | ✅ Done — LOGIN/LOGOUT logged with IP + userAgent                                |
| Jotai workspace store (localStorage)  | ✅ Done                                                                          |
| `Workspace` DB model                  | ✅ Schema exists, authorized service empty                                       |
| `getProfile`                          | ⬜ Commented out                                                                 |
| Workspace API                         | ⬜ Not implemented                                                               |

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

## Dependency Order

```
Phase 1 (RefreshToken)
  └─ Phase 2 (AccessToken — needs refresh endpoint from Phase 1)
       └─ Phase 3 (Auth Module — needs stable token lifecycle)
            └─ Phase 4 (Testing — validates Phase 1-3)
                 └─ Phase 5 (Workspace — needs auth + user identity fully working)
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
