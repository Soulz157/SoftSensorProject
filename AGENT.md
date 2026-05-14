# AGENT.md — 🚀 Production-Grade Rules (Next.js 16 & NestJS)

This document outlines the strict guidelines for any AI agent working in this repository.
**Production-Ready** system. "Quick hacks," hardcoded mock data, and bypassing type safety are strictly prohibited. The focus is on Scalability, Security, Maintainability, and Performance.

---

## 1. The Production Mindset (Before You Start)

* **Plan Before Coding:** Production systems require careful architectural thought. If you are asked to build a feature, **you must outline the database schema, API contract (DTOs), and component structure, and ask the user for approval before writing the actual code.**
* **No Mock Data:** Never generate or use static JSON mock files for business logic. Always connect to the real database (Prisma) or external APIs.
* **Zero Tolerance for `any`:** Type safety is non-negotiable. If you don't know a type, investigate or ask the user. Do not use `any` or `@ts-ignore`.

---

## 2. Frontend — Next.js (App Router)

### Architecture & Rendering

* **Server Components First:** Default to React Server Components (RSC). Only add `"use client"` when interactivity (hooks, event listeners) is strictly required. Do not place `"use client"` at the top of a layout or page unless absolutely necessary.
* **Data Fetching:** Use Next.js native `fetch` with proper caching/revalidation tags or a robust server-state library like TanStack React Query.
* **State Management:** Avoid global contexts for simple things. Use **Zustand** for complex client state and **React Query** for server state.
* **Component Size:** If a component becomes too large, deeply nested, or overly complex, break it down into smaller, manageable, and reusable sub-components.

### UI & Styling (Tailwind 4 & Shadcn)

* **Never modify** auto-generated files in `components/ui/**`. Treat them as immutable third-party code.
* Use standard Tailwind 4 classes. Use CSS variables for theming (`bg-primary`, `text-destructive`). Never hardcode hex colors.
* **Performance:** Always use `<Image>` from `next/image` for images, and `<Link>` from `next/link` for routing.

### Error Handling & UX

* Implement `error.tsx` and `loading.tsx` for all major route segments.
* Use Toast notifications (e.g., Sonner) to handle API error feedback on the client side gracefully.

---

## 3. Backend — NestJS (Production Architecture)

### Layered Architecture (Strict Boundaries)

Keep a strict separation of concerns (Domain-Driven Design concepts):

1. **Controllers:** Only handle HTTP requests, routing, and DTO validation. **No business logic here.**
2. **Services:** Contain the core business logic.
3. **Repositories/Prisma:** Handle direct database interactions. Services call Prisma.

### Database & Prisma (PostgreSQL)

* Never write raw SQL queries for standard operations; use Prisma Client.
* **Migrations are Sacred:** Never manually alter the database schema. Always modify `schema.prisma` and run `npx prisma migrate dev`.
* **Transactions:** Use Prisma `$transaction` when performing multiple dependent write operations to ensure ACID compliance.

### Validation & Serialization

* **Global Validation:** Every incoming request body MUST be validated using `class-validator` and `class-transformer` in DTOs.
* Use `@Type()` for nested objects and array validation in DTOs.
* Never expose internal database IDs (like incremental integers) if UUID/CUID is the standard for public-facing endpoints. Exclude sensitive fields (like passwords) using `class-transformer`'s `@Exclude()`.

### Performance & Async Jobs

* If a process takes longer than 500ms (e.g., sending emails, generating reports), do not block the HTTP response. Use **BullMQ (Redis)** for background job processing.
* Cache heavy read-queries using Redis via NestJS CacheManager.

---

## 4. Security (Zero Trust)

* **Authentication & Authorization:**
  * Use strictly configured `JwtAuthGuard`.
  * Implement Role-Based Access Control (RBAC) or Attribute-Based Access Control (ABAC) using custom Guards (e.g., `RolesGuard`).
  * **Tokens:** Store Refresh Tokens in `HttpOnly, Secure, SameSite=Strict` cookies. Access Tokens can be short-lived and returned in JSON.
* **Input Sanitization:** Guard against XSS and SQL Injection. Trust no user input.
* **Environment Variables:** Never commit `.env` files. Ensure all secrets are validated on application startup (using Joi or Zod).
* **Rate Limiting:** Ensure `@nestjs/throttler` is implemented to prevent DDoS or brute-force attacks on public endpoints (especially `/auth`).

---

## 5. Error Handling & Logging

* **No Silent Failures:** Catch exceptions properly.
* **Standardized Responses:** Use a global Exception Filter (`HttpExceptionFilter`) to ensure the frontend always receives a consistent error structure:

    ```json
    {
      "statusCode": 400,
      "message": "Validation failed",
      "error": "Bad Request",
      "timestamp": "2026-05-14T08:26:40Z"
    }
