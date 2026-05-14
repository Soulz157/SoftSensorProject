# SoftSensor

> Smart monitoring platform for industrial soft sensor management and AI model analytics.

---

## Stack

| Layer    | Technology                                    |
| -------- | --------------------------------------------- |
| Monorepo | Turborepo + pnpm workspaces                   |
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Backend  | NestJS 11, TypeScript                         |
| Database | PostgreSQL via Prisma 7 (PrismaPg adapter)    |
| Styling  | Tailwind CSS v4, shadcn/ui                    |
| Runtime  | Node ≥ 20                                     |

---

## Project Structure

```text
SoftSensorProject/
├── apps/
│   ├── backend/           # NestJS API — port 8000
│   └── client/            # Next.js frontend — port 3000
├── packages/
│   ├── prisma/            # @softsensor/prisma — shared DB layer
│   ├── eslint-config/     # Shared ESLint config
│   └── typescript-config/ # Shared tsconfig bases
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 — `npm install -g pnpm`
- **PostgreSQL** running locally or via Docker

### 1. Clone & Install

```bash
git clone <repo-url>
cd SoftSensorProject
pnpm install
```

### 2. Environment Variables

Copy the example env file at the root:

```bash
cp .env.example .env
```

Fill in the required values:

```env
# Database
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/softsensor"

# Backend
SERVER_PORT=8000
CORS_ORIGIN=http://localhost:3000

# JWT
JWT_SECRET=your_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
```

### 3. Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations (creates tables)
pnpm db:migrate
```

### 4. Run Development Servers

```bash
pnpm dev
```

Starts both apps concurrently:

| App      | URL                                            |
| -------- | ---------------------------------------------- |
| Frontend | [http://localhost:3000](http://localhost:3000) |
| Backend  | [http://localhost:8000](http://localhost:8000) |

---

## Available Scripts

```bash
# Development
pnpm dev              # Run all apps concurrently

# Build
pnpm build            # Build all apps and packages

# Quality
pnpm lint             # Lint all
pnpm type-check       # Type-check all (tsc --noEmit)

# Single app
pnpm --filter client dev
pnpm --filter backend dev

# Tests
pnpm --filter backend test -- --testPathPattern=<filename>
```

---

## Database

Schema lives at `packages/prisma/prisma/schema.prisma` — **edit only this file**.

### Workflow

```bash
# 1. Edit schema.prisma
# 2. Regenerate client
pnpm db:generate

# 3. Create & apply migration
pnpm db:migrate
```

### Multi-step Writes

Always use transactions for multi-step operations:

```ts
await prisma.$transaction([
  prisma.user.create({ data: { ... } }),
  prisma.sensor.create({ data: { ... } }),
])
```

### Using PrismaService in Backend

`PrismaModule` is `@Global()` — import it **once** in `AppModule`, then inject `PrismaService` anywhere:

```ts
// app.module.ts — import once
@Module({
  imports: [PrismaModule, ...],
})
export class AppModule {}

// any.service.ts — just inject
@Injectable()
export class SensorService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.sensor.findMany()
  }
}
```

### Adding a New Model

1. Edit `packages/prisma/prisma/schema.prisma`
2. Run `pnpm db:generate` → regenerates client
3. Run `pnpm db:migrate` → creates migration file + applies to DB
4. Never edit files inside `packages/prisma/src/generated/` directly

---

## Architecture Overview

### Backend — Strict Layered Pattern

```text
Request
  └─▶ Controller   (route handlers, DTO validation)
        └─▶ Service  (business logic)
              └─▶ PrismaService  (DB queries)
```

- DTOs validated with `class-validator` + `class-transformer`
- Long-running work (>500ms): use **BullMQ** — never block HTTP
- Auth: `JwtAuthGuard` + `RolesGuard`; refresh tokens in `HttpOnly` cookies only

### Frontend — Server-First

- Default to **Server Components** — only add `"use client"` when hooks or event listeners are needed
- Server data → `fetch()` with revalidation tags
- Client server state → TanStack React Query (`staleTime: 60s`)
- Complex client state → Zustand
- UI components: shadcn/ui — **never edit** `components/ui/`, add via `npx shadcn add <component>`

---

## Key Constraints

- No `any` or `@ts-ignore` — zero tolerance
- No mock data — always connect to real Prisma/APIs
- Never skip `pnpm db:migrate` after schema changes
- Never edit generated files in `packages/prisma/src/generated/`

---

## Further Reading

- [Codebase Reference](docs/CODEBASE.md) — detailed component APIs, Prisma patterns, coding style
