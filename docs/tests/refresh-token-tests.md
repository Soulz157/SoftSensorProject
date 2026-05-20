# Refresh Token Test Plan

These tests verify the rotating refresh-token flow implemented in `AuthAuthorizedService` and `AuthAuthorizedController`. The service rotates the opaque refresh token on every use (delete-old / create-new inside a single `$transaction`), issues a 15-minute access JWT, and stores the new refresh token in an `HttpOnly` cookie. The controller reads the cookie from the incoming Fastify request and writes the rotated value back through Fastify's `setCookie` / `clearCookie` APIs.

All tests are **unit tests** that use Jest manual mocks for `PrismaService` and `JwtService`. No real database is touched.

---

## Service Tests

Co-located file: `apps/backend/src/api/v1/auth/authorized/auth.authorized.service.spec.ts`

### `refreshService`

- [ ] **TC-01** — Happy path: given a valid, non-expired, non-revoked token, `refreshService` returns `{ response: { statusCode: 200, data: { accessToken } }, refreshToken }` where `refreshToken` is a 128-character hex string.
  - Input: `findUnique` returns a record with `expiresAt` in the future and `revokedAt = null`.
  - Expected: return shape matches, `accessToken` equals the JWT mock's return value.

- [ ] **TC-02** — Token rotation: `$transaction` is called exactly once with an array of two operations (delete old + create new).
  - Input: same valid record as TC-01.
  - Expected: `prismaMock.$transaction` called once; the argument is an array of length 2.

- [ ] **TC-03** — JWT payload: `jwtService.sign` is called with the exact user fields (`id`, `email`, `firstName`, `lastName`, `company`, `role`) and options `{ expiresIn: '15m' }`.
  - Input: valid record with known user data.
  - Expected: `jwtMock.sign` called with matching arguments.

- [ ] **TC-04** — Token not found: when `findUnique` returns `null`, `refreshService` throws an `AppException` with `statusCode: 401` and message `'Refresh token invalid or expired'`.
  - Input: `findUnique` resolves to `null`.
  - Expected: `rejects.toMatchObject({ statusCode: 401, message: 'Refresh token invalid or expired' })`.

- [ ] **TC-05** — Token expired: when `record.expiresAt` is in the past, `refreshService` throws `AppException` 401.
  - Input: `findUnique` returns a record with `expiresAt = Date.now() - 1000`.
  - Expected: same as TC-04.

- [ ] **TC-06** — Token revoked: when `record.revokedAt` is a non-null `Date`, `refreshService` throws `AppException` 401.
  - Input: `findUnique` returns a record with `revokedAt = new Date()`.
  - Expected: same as TC-04.

- [ ] **TC-07** — TTL of new token: the `expiresAt` timestamp passed to `refreshToken.create` is within 5 seconds of `Date.now() + 7 days`.
  - Input: valid record; `refreshToken.create` mock captures its `data` argument.
  - Expected: `Math.abs(capturedExpiresAt - (beforeCall + 7*24*60*60*1000)) <= 5000`.

### `logoutService`

- [ ] **TC-08** — Happy path: `$transaction` is called once; the method returns `{ statusCode: 200, message: 'ออกจากระบบสำเร็จ', type: 'SUCCESS' }`.
  - Input: any `userId`, any `meta`.
  - Expected: return value matches exactly; `$transaction` call count is 1.

- [ ] **TC-09** — Meta forwarded: `authLog.create` is called with `data` containing the `ipAddress` and `userAgent` from the `meta` argument.
  - Input: `userId = 'user-id-1'`, `meta = { ipAddress: '192.168.1.1', userAgent: 'Mozilla/5.0' }`.
  - Expected: `authLog.create` called with `expect.objectContaining({ data: expect.objectContaining({ ipAddress, userAgent }) })`.

- [ ] **TC-10** — No meta: when `meta` is `undefined`, `logoutService` resolves without throwing and still returns the success shape.
  - Input: only `userId` passed (no second argument).
  - Expected: resolves to `{ statusCode: 200, type: 'SUCCESS' }`; `$transaction` called once.

---

## Controller Tests

Co-located file: `apps/backend/src/api/v1/auth/authorized/auth.authorized.controller.spec.ts`

### `refreshController`

- [ ] **TC-11** — Happy path: controller reads the `refresh_token` cookie from `req.cookies`, calls `authAuthorizedService.refreshService(token)`, sets the rotated cookie via `res.setCookie('refresh_token', newToken, REFRESH_TOKEN_COOKIE)`, and returns the response body.
  - Input: `req.cookies = { refresh_token: 'existing-token' }`, service resolves with `{ response, refreshToken }`.
  - Expected: `serviceMock.refreshService` called with `'existing-token'`; `res.setCookie` called with `'refresh_token'`, the new token, and the cookie options object; return value equals `serviceResponse`.

- [ ] **TC-12** — Cookie options: `res.setCookie` is called with the `REFRESH_TOKEN_COOKIE` options object (httpOnly, maxAge 7 days, correct path).
  - Input: any valid service response.
  - Expected: third argument of `setCookie` strictly equals `REFRESH_TOKEN_COOKIE`.

- [ ] **TC-13** — Missing cookie: when `req.cookies` is `undefined`, the controller passes `''` (empty string) to `refreshService`.
  - Input: `req.cookies = undefined`.
  - Expected: `serviceMock.refreshService` called with `''`.

### `logoutController`

- [ ] **TC-14** — Happy path: controller calls `logoutService(user.id, { ipAddress: req.ip, userAgent: req.headers['user-agent'] })` and returns the service result.
  - Input: `user = { id: 'user-id-1', ... }`, `req.ip = '10.0.0.1'`, `req.headers['user-agent'] = 'Chrome/120'`.
  - Expected: `serviceMock.logoutService` called with `('user-id-1', { ipAddress: '10.0.0.1', userAgent: 'Chrome/120' })`; result equals the service return value.

- [ ] **TC-15** — Cookie cleared: `reply.clearCookie` is called exactly once with `'refresh_token'` and the `CLEAR_REFRESH_TOKEN_COOKIE` options (maxAge 0).
  - Input: any valid service response.
  - Expected: `reply.clearCookie` call count is 1; called with `('refresh_token', CLEAR_REFRESH_TOKEN_COOKIE)`.

---

## How to Run

```bash
# Run both spec files (service + controller)
pnpm --filter backend test -- --testPathPatterns=auth.authorized

# Run service spec only
pnpm --filter backend test -- --testPathPatterns=auth.authorized.service

# Run controller spec only
pnpm --filter backend test -- --testPathPatterns=auth.authorized.controller

# Watch mode during development
pnpm --filter backend test -- --watch --testPathPatterns=auth.authorized
```

> Note: the flag is `--testPathPatterns` (plural) — this project uses Jest 30 which replaced the deprecated `--testPathPattern`.
