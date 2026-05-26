# QA Flow — SoftSensor

Step-by-step guide for verifying a release. Follow top-to-bottom. Complete every section before signing off.

---

## 1. Prerequisites

### 1.1 Required environment variables

Verify the following are present in the root `.env` file (or exported in shell):

```
DATABASE_URL=postgresql://...      # points to a test/staging PostgreSQL database
JWT_SECRET=...
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
CORS_ORIGINS=http://localhost:3000
SERVER_PORT=8000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
```

- [ ] All required env vars are present in `.env`
- [ ] `DATABASE_URL` points to a **test or staging** database — never production

### 1.2 Services running

Open two terminals:

```bash
# Terminal 1 — backend (NestJS, port 8000)
pnpm --filter backend dev

# Terminal 2 — frontend (Next.js, port 3000)
pnpm --filter client dev
```

Alternatively, run all apps together:

```bash
pnpm dev
```

- [ ] Backend responds: `GET http://localhost:8000/api/v1/public/auth/login` returns HTTP 405 (method not allowed — GET hits a POST-only route, confirming the server is up)
- [ ] Frontend responds: `http://localhost:3000` loads without console errors

### 1.3 Database seeded

```bash
# Apply any pending migrations
pnpm db:migrate:dev

# Open Prisma Studio to verify data (optional)
pnpm db:studio
```

- [ ] Migrations applied cleanly (exit code 0)
- [ ] At least one `User` record exists with `role = 'USER'`

### 1.4 Admin account

The register endpoint creates all users with the default `USER` role. No role-escalation endpoint exists in the current release. To test admin-only routes, manually promote a user via Prisma Studio or SQL:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'your-admin@example.com';
```

- [ ] An ADMIN user exists in the database with known credentials

### 1.5 Swagger UI (optional but useful)

```
http://localhost:8000/swagger
```

Use this to inspect request/response shapes while running manual tests.

---

## 2. Automated Tests

### 2.1 Backend unit tests (Jest 30)

```bash
pnpm --filter backend test
```

Expected output:

- All test suites pass with exit code 0
- `--passWithNoTests` is set, so an empty suite does not fail
- Summary line resembles: `Test Suites: X passed, X total`

**Run a specific suite:**

```bash
# Auth authorized (refresh + logout) — TC-01..TC-15
pnpm --filter backend test -- --testPathPatterns=auth.authorized

# Auth public (register, login, OAuth, forgot-password, change-password)
pnpm --filter backend test -- --testPathPatterns=auth.public

# Workspace authorized (list all, get by id)
pnpm --filter backend test -- --testPathPatterns=workspace.authorized

# Workspace admin (create, update, delete)
pnpm --filter backend test -- --testPathPatterns=workspace-admin

# Mail admin
pnpm --filter backend test -- --testPathPatterns=mail.admin

# Mail authorized
pnpm --filter backend test -- --testPathPatterns=mail.authorized
```

- [ ] `pnpm --filter backend test` exits 0
- [ ] No test suite reports failures or skipped tests unexpectedly

**Refresh-token test plan reference:** `docs/tests/refresh-token-tests.md` documents TC-01..TC-15 covering `refreshService` and `logoutService` (service unit tests) and `refreshController` + `logoutController` (controller unit tests). Verify those 15 cases pass under the `auth.authorized` suite.

### 2.2 Frontend unit tests (Vitest)

```bash
pnpm --filter client test
```

Expected output:

- Suite `hooks/__tests__/useAuth.test.ts` runs 3 tests
- All 3 pass; exit code 0

```bash
# Run with verbose output
pnpm --filter client test -- --reporter=verbose
```

- [ ] `pnpm --filter client test` exits 0
- [ ] `useAuth` suite: 3/3 tests pass (unauthenticated state, authenticated state, login call)

### 2.3 Full monorepo run

```bash
pnpm test
```

- [ ] Turborepo runs both `client` and `backend` test tasks without error

---

## 3. Coverage Check

```bash
# Backend coverage
pnpm --filter backend test:coverage

# Client coverage
pnpm --filter client test:coverage

# Both
pnpm test:coverage
```

Reports are written to:

- `apps/backend/coverage/` (lcov, text)
- `apps/client/coverage/` (v8, html at `apps/client/coverage/index.html`)

**No numeric threshold is configured** in either `jest` config or `vitest.config.ts`. Compare reports against the previous release's coverage totals. Flag any file whose uncovered line percentage increased significantly.

- [ ] Backend coverage report generated without error
- [ ] Client coverage report generated without error
- [ ] Coverage has not regressed compared to the previous release baseline

---

## 4. Manual Test Flows

### 4.1 Registration

**Endpoint:** `POST /api/v1/public/auth/register`

| Step | Action                                                           | Expected                                                                       |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1    | Navigate to `http://localhost:3000/register`                     | Register form renders                                                          |
| 2    | Fill in first name, last name, email, password, confirm password | All fields accept input                                                        |
| 3    | Submit with valid data                                           | HTTP 201 from backend; redirected to `/login`                                  |
| 4    | Check the database                                               | New `User` row exists with `role = 'USER'`; password column stores argon2 hash |
| 5    | Try submitting the same email again                              | Error message shown (email already registered)                                 |
| 6    | Try submitting with password mismatch                            | Client-side validation prevents submit or error shown                          |
| 7    | Try submitting with an empty required field                      | Validation error shown; request not sent                                       |

- [ ] Registration with valid data succeeds (HTTP 201, redirect)
- [ ] Duplicate email returns an error (HTTP 400)
- [ ] Required field validation prevents empty submissions
- [ ] Password is never stored in plaintext (verify via Prisma Studio)

### 4.2 Login

**Endpoint:** `POST /api/v1/public/auth/login`

| Step | Action                                    | Expected                                                                                |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| 1    | Navigate to `http://localhost:3000/login` | Login form renders                                                                      |
| 2    | Enter valid credentials                   | HTTP 200 from backend; response body contains `{ data: { accessToken } }`               |
| 3    | Check browser cookies                     | `refresh_token` cookie is present, flagged as `HttpOnly`, `Secure` (if HTTPS), `Path=/` |
| 4    | Observe redirect                          | Browser navigates to `/dashboard`                                                       |
| 5    | Enter wrong password                      | HTTP 400 or 401; error toast shown; no cookie set                                       |
| 6    | Enter a non-existent email                | HTTP 400 or 401; error toast shown                                                      |
| 7    | Leave email/password blank                | Validation error shown; request not sent                                                |

- [ ] Valid login returns access token and sets `refresh_token` cookie
- [ ] Redirect to `/dashboard` after successful login
- [ ] Wrong password shows error toast and does not set cookie
- [ ] Non-existent email shows error toast and does not set cookie

### 4.3 Token Refresh (automated path)

**Endpoint:** `POST /api/v1/authorized/auth/refresh`

This flow is handled automatically by NextAuth in `lib/auth/index.ts` via the `jwt()` callback. It is not easily triggered manually without shortening the JWT TTL. The behavior is covered by TC-01..TC-07 in `docs/tests/refresh-token-tests.md`.

To verify indirectly:

| Step | Action                                                                                                                                    | Expected                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | Log in normally                                                                                                                           | Session established                                                                                      |
| 2    | Open DevTools > Application > Cookies                                                                                                     | `refresh_token` cookie is HttpOnly (not readable via JS)                                                 |
| 3    | Wait 15+ minutes with tab open, then interact with a protected page                                                                       | App continues to work; no redirect to login                                                              |
| 4    | To force a refresh cycle, set `JWT_EXPIRES_IN=30s` in `.env`, restart backend, log in, wait 30 seconds, then navigate to a protected page | NextAuth silently calls the refresh endpoint; new access token issued; `refresh_token` cookie is rotated |

- [ ] `refresh_token` cookie is HttpOnly (confirmed via DevTools)
- [ ] Session persists beyond the JWT TTL (silent refresh occurs)
- [ ] Rotating token: each refresh call replaces the `refresh_token` cookie value

### 4.4 Session Expired / Revoked Refresh Token

| Step | Action                                                                                                                                                  | Expected                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1    | Log in and note the `refresh_token` cookie value via DevTools (before it becomes HttpOnly on send — use the Network tab to observe `Set-Cookie` header) | Token value visible in response headers                                           |
| 2    | In Prisma Studio, set `revokedAt = NOW()` on that `RefreshToken` row                                                                                    | Token is now revoked in DB                                                        |
| 3    | Navigate to a protected page or wait for the next silent refresh attempt                                                                                | `session.error === 'RefreshTokenExpired'` triggers; browser redirects to `/login` |
| 4    | Alternatively: delete the `RefreshToken` row entirely                                                                                                   | Same redirect outcome                                                             |

- [ ] Revoked refresh token causes session expiry redirect to `/login`
- [ ] Deleted refresh token causes session expiry redirect to `/login`
- [ ] No sensitive error detail is exposed to the browser (check Network tab)

### 4.5 Logout

**Endpoint:** `POST /api/v1/authorized/auth/logout`

| Step | Action                                                                                                                  | Expected                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1    | While logged in, open the navbar user dropdown                                                                          | Logout option visible                                                                       |
| 2    | Click Logout                                                                                                            | `POST /api/v1/authorized/auth/logout` fires with `Authorization: Bearer <token>`            |
| 3    | Observe the response                                                                                                    | HTTP 200, body contains `{ statusCode: 200, message: 'ออกจากระบบสำเร็จ', type: 'SUCCESS' }` |
| 4    | Check cookies in DevTools                                                                                               | `refresh_token` cookie is cleared (absent or expired)                                       |
| 5    | Check the database                                                                                                      | `RefreshToken` rows for this user are deleted; `AuthLog` has a new `LOGOUT` entry           |
| 6    | Try navigating to `/dashboard`                                                                                          | Redirect to `/login`                                                                        |
| 7    | Try calling `GET /api/v1/authorized/auth/me` with the old access token (wait for token to expire or use an invalid one) | HTTP 401                                                                                    |

- [ ] Logout clears the `refresh_token` cookie
- [ ] Logout deletes `RefreshToken` DB rows for the user
- [ ] Logout creates an `AuthLog` entry with action `LOGOUT`
- [ ] Post-logout navigation to protected routes redirects to `/login`

### 4.6 Admin Activity Log

**Route:** `GET /api/v1/auth/admin/activity-log` and `GET /api/v1/auth/admin/user-stats`
**Frontend page:** `/admin/activity`

**Prerequisite:** User must have `role = 'ADMIN'` (see section 1.4).

| Step | Action                                                                                                                    | Expected                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1    | Log in as an ADMIN user                                                                                                   | Session established with `role: 'ADMIN'`                                                                          |
| 2    | Navigate to `http://localhost:3000/admin/activity`                                                                        | Page renders; no redirect                                                                                         |
| 3    | Observe the AuthLog table                                                                                                 | Paginated list of login/logout events; each row shows user, action, IP address, timestamp                         |
| 4    | Click Next page                                                                                                           | Query string `?page=2` (or similar); table updates; previous rows not shown during fetch (table dims during load) |
| 5    | Observe the User Stats table                                                                                              | List of users with 7-day login counts                                                                             |
| 6    | Call the API directly with Swagger or curl: `GET /api/v1/auth/admin/activity-log?page=1&limit=20` with ADMIN bearer token | HTTP 200; `{ data: { items: [...], total, page, limit } }`                                                        |
| 7    | Call with a non-ADMIN bearer token                                                                                        | HTTP 403                                                                                                          |
| 8    | Call without any token                                                                                                    | HTTP 401                                                                                                          |

- [ ] ADMIN user can view `/admin/activity` page
- [ ] Activity log table is paginated and shows AuthLog data
- [ ] User stats table shows per-user 7-day login counts
- [ ] Non-ADMIN bearer token returns HTTP 403
- [ ] Missing token returns HTTP 401

### 4.7 Non-ADMIN access to admin routes

| Step | Action                                                         | Expected                                                                |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | Log in as a regular `USER`                                     | Session established with `role: 'USER'`                                 |
| 2    | Navigate to `http://localhost:3000/admin/activity`             | Server-side role check in `app/admin/layout.tsx` fires; redirect to `/` |
| 3    | Navigate to `http://localhost:3000/admin`                      | Redirect to `/`                                                         |
| 4    | Log out and navigate to `http://localhost:3000/admin/activity` | Redirect to `/login`                                                    |

- [ ] USER role redirected to `/` when accessing `/admin/*`
- [ ] Unauthenticated users redirected to `/login` when accessing `/admin/*`

### 4.8 Unauthenticated access to protected routes

| Step | Action                                        | Expected             |
| ---- | --------------------------------------------- | -------------------- |
| 1    | Clear all cookies or open an incognito window | No session           |
| 2    | Navigate to `http://localhost:3000/dashboard` | Redirect to `/login` |
| 3    | Navigate to `http://localhost:3000/settings`  | Redirect to `/login` |
| 4    | Navigate to `http://localhost:3000/analytics` | Redirect to `/login` |

- [ ] All protected routes under `/(default)/` redirect to `/login` when unauthenticated

### 4.9 Settings

**Routes:** `/settings` and sub-sections (`/settings/appearance`, etc. — rendered as components within the settings page)

| Step | Action                                                                   | Expected                                                                                           |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1    | Log in and navigate to `/settings`                                       | Settings page renders; sidebar shows Appearance, Account, Plans, Workspace sections                |
| 2    | Appearance tab: change theme                                             | Theme toggles (light/dark); preference persists on reload                                          |
| 3    | Account tab: edit first name, last name                                  | `PATCH /api/v1/authorized/auth/me` fires; success toast shown; header/navbar reflects updated name |
| 4    | Account tab: change password (current password + new password + confirm) | `POST /api/v1/authorized/auth/change-password` fires; success toast shown                          |
| 5    | Account tab: enter wrong current password                                | Error toast shown; password not changed                                                            |
| 6    | Workspace tab: create a new workspace                                    | `POST /api/v1/admin/workspace/create` fires; new workspace appears in list                         |
| 7    | Workspace tab: rename an existing workspace                              | `PATCH /api/v1/admin/workspace/:id` fires; name updates in UI                                      |
| 8    | Workspace tab: delete a workspace                                        | `DELETE /api/v1/admin/workspace/delete` fires; workspace removed from list                         |

- [ ] Account profile edit updates the database and reflects in the UI
- [ ] Change password succeeds with correct current password
- [ ] Change password fails with wrong current password (error toast, no change)
- [ ] Workspace CRUD operations complete without error

### 4.10 API down / backend unreachable

| Step | Action                                                                       | Expected                                                                                 |
| ---- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1    | Stop the backend process                                                     | `http://localhost:8000` unreachable                                                      |
| 2    | Navigate to the login page and attempt to log in                             | `fetchClient` throws a network error; `toast.error(...)` shown; no crash or blank screen |
| 3    | While logged in with a valid session, navigate to any page that fetches data | Error state shown (error boundary or toast); page does not crash                         |
| 4    | Restart the backend                                                          | Functionality resumes on next user action                                                |

- [ ] Network failure on login shows error toast, not a crash
- [ ] Network failure on authenticated pages shows error state gracefully

---

## 5. Pass/Fail Checklist

Copy this checklist into your release sign-off ticket or PR comment.

### Automated

- [ ] `pnpm --filter backend test` — all suites pass
- [ ] `pnpm --filter client test` — 3/3 useAuth tests pass
- [ ] `pnpm test` (monorepo) — exits 0
- [ ] `pnpm --filter backend test -- --testPathPatterns=auth.authorized` — TC-01..TC-15 all pass
- [ ] Coverage reports generated without error for both apps

### Build

- [ ] `pnpm build` — exits 0, no TypeScript errors in backend or client

### Auth

- [ ] Registration — valid data creates user, duplicate email rejected
- [ ] Login — valid credentials return access token and set HttpOnly cookie
- [ ] Login — wrong password / unknown email shows error toast
- [ ] Token refresh — `refresh_token` cookie is HttpOnly; session survives beyond JWT TTL
- [ ] Revoked token — triggers `RefreshTokenExpired` session error and redirect to `/login`
- [ ] Logout — clears cookie, deletes `RefreshToken` rows, logs `LOGOUT` entry

### Admin

- [ ] ADMIN user can access `/admin/activity` page
- [ ] Activity log is paginated; user stats rendered
- [ ] USER role redirected to `/` on admin routes
- [ ] Unauthenticated redirected to `/login` on admin routes
- [ ] `GET /api/v1/auth/admin/activity-log` returns 403 for non-ADMIN token
- [ ] `GET /api/v1/auth/admin/activity-log` returns 401 for missing token

### Route Guards

- [ ] Unauthenticated access to `/dashboard`, `/settings`, `/analytics` redirects to `/login`

### Settings

- [ ] Profile edit persists to database
- [ ] Change password succeeds with correct current password; fails with wrong one
- [ ] Workspace CRUD (create, rename, delete) works end-to-end

### Error Handling

- [ ] Backend unreachable → error toast shown, no crash

---

## 6. Known Gaps

The following behaviors exist in the codebase but are **not currently covered by automated tests**.

| Area                     | Gap                                                                                                                           | Notes                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frontend (client)        | Zero automated coverage for pages, components, stores, and service wrappers                                                   | Only `useAuth` (3 unit tests) exist. All UI flows are manual-only.                    |
| Auth admin               | No automated tests for `AuthAdminService` or `AuthAdminController`                                                            | `auth/admin/auth.admin.service.spec.ts` does not exist yet.                           |
| Workspace authorized     | Spec files exist but may be empty stubs — verify with `pnpm --filter backend test -- --testPathPatterns=workspace.authorized` | Check test count in output.                                                           |
| Workspace admin          | Same as above for `workspace-admin.service.spec.ts` and `workspace-admin.controller.spec.ts`                                  | Check test count.                                                                     |
| Mail admin / authorized  | Spec files exist but content unverified                                                                                       | Check test count.                                                                     |
| OAuth login              | `POST /api/v1/public/auth/OAuth/login` endpoint exists and is implemented; no test plan written                               | Not covered in `docs/tests/refresh-token-tests.md`.                                   |
| Forgot password          | `POST /api/v1/public/auth/forgot-password` exists; no automated test                                                          | Email sending is side-effectful — test plan should mock the mail service.             |
| Change password (public) | `POST /api/v1/public/auth/change-password` (reset via token) exists; no automated test                                        | Distinct from the authorized `POST /api/v1/authorized/auth/change-password`.          |
| E2E tests                | No E2E test suite (Playwright, Cypress) exists                                                                                | `apps/backend/test/jest-e2e.json` is present but `test/` directory has no spec files. |
| Coverage thresholds      | No enforced minimum in `jest` config or `vitest.config.ts`                                                                    | Regressions are only caught by manual comparison.                                     |
| Integration tests        | All backend tests use mocked PrismaService — no tests hit a real database                                                     | Database-level bugs (constraint violations, query correctness) are not caught.        |
