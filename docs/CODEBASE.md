# SoftSensor — Codebase Documentation

## Overview

**SoftSensor** is a smart monitoring platform for industrial soft sensor management and AI model analytics.

| Layer    | Technology                                        |
| -------- | ------------------------------------------------- |
| Monorepo | Turborepo + pnpm workspaces                       |
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5.9 |
| Backend  | NestJS 11, TypeScript 5.7                         |
| Database | PostgreSQL via Prisma 7 (PrismaPg adapter)        |
| Styling  | Tailwind CSS v4, shadcn/ui                        |
| Runtime  | Node ≥ 20                                         |

---

## Monorepo Structure

```
SoftSensorProject/
├── apps/
│   ├── backend/           # NestJS API — port 8000
│   └── client/            # Next.js frontend — port 3000
├── packages/
│   ├── prisma/            # @softsensor/prisma — shared DB layer
│   ├── eslint-config/     # Shared ESLint config
│   └── typescript-config/ # Shared tsconfig bases
├── turbo.json             # Task pipeline (build, lint, dev, check-types)
├── pnpm-workspace.yaml
└── package.json
```

### Common Scripts

```bash
pnpm dev              # Run all apps concurrently (loads .env via dotenvx)
pnpm build            # Build all
pnpm lint             # Lint all
pnpm type-check       # tsc --noEmit all

pnpm db:generate      # Regenerate Prisma client after schema changes
pnpm db:migrate       # prisma migrate dev

# Per-app
pnpm --filter frontend dev
pnpm --filter backend dev
pnpm --filter backend test -- --testPathPattern=<filename>
```

---

## Backend (`apps/backend/`)

### Structure

```
apps/backend/
└── src/
    ├── main.ts          # Bootstrap — listens on SERVER_PORT (default 8000)
    ├── app.module.ts    # Root module — ConfigModule.forRoot isGlobal:true
    └── api/             # Feature modules (in progress)
```

### Architecture

Strict layered pattern: **Controller → Service → PrismaService**. No business logic in controllers.

```
Request
  └─▶ Controller     (route handlers, DTOs validation)
        └─▶ Service  (business logic)
              └─▶ PrismaService  (DB queries)
```

### Conventions

- DTOs validated with `class-validator` + `class-transformer`; use `@Exclude()` on sensitive fields
- Long-running work (>500ms): delegate to BullMQ (Redis), never block HTTP
- Auth: `JwtAuthGuard` + `RolesGuard`; refresh tokens in `HttpOnly` cookies only
- Global `ValidationPipe` (whitelist + transform), `HttpExceptionFilter`, `ClassSerializerInterceptor`

---

## Frontend (`apps/client/`)

### Structure

```
apps/client/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout: fonts, ThemeProvider, TooltipProvider
│   ├── globals.css               # Global Tailwind styles
│   ├── page.tsx                  # / — LandingPage (client component)
│   ├── login/
│   │   └── page.tsx              # /login
│   └── pagePrefer.tsx            # Preferences (in progress)
├── components/
│   ├── navbar.tsx                # Custom: top header
│   ├── sidebar.tsx               # Custom: collapsible sidebar
│   ├── theme-provider.tsx        # next-themes wrapper
│   └── ui/                       # shadcn/ui — DO NOT EDIT (34 components)
├── hooks/
│   └── use-mobile.ts             # useIsMobile() — 768px breakpoint
├── lib/
│   └── utils.ts                  # cn() — clsx + tailwind-merge
└── public/                       # Static assets
```

---

## Components (`apps/client/components/`)

### Custom Components

#### `navbar.tsx`

Top header bar. Handles responsive search (mobile icon / desktop input), Create Workspace button, and login/user dropdown menu.

```ts
interface NavbarProps {
  onCreateWorkspace?: () => void
  onMenuClick?: () => void
}
```

State: `isLoggedIn`, `searchOpen` (local `useState`).  
Responsive: search icon shown on mobile (`sm:hidden`), full input on desktop (`hidden sm:flex`).

#### `sidebar.tsx`

Collapsible navigation sidebar. Features: workspace switcher, nav items with active state detection, upgrade widget, mobile overlay with backdrop blur.

```ts
interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  activeWorkspace: string
  onWorkspaceChange: (id: string) => void
  workspaceOpen: boolean
  onWorkspaceToggle: () => void
}
```

Nav items: Dashboard `/`, Models `/models`, Analytics `/analytics`, Settings `/settings`, Plans & Billing `/plans`.  
Active detection via `usePathname()` — exact match for `/`, `startsWith` for others.

#### `theme-provider.tsx`

Thin wrapper around `next-themes` `ThemeProvider`. Used in root layout with `defaultTheme="dark"` and `enableSystem`.

### shadcn/ui Components (`components/ui/` — immutable)

> Never edit these files. Add new components via `npx shadcn add <component>`.

| Category   | Components                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Layout     | `accordion`, `card`, `breadcrumb`, `sheet`, `scroll-area`, `separator`, `sidebar`                                     |
| Forms      | `alert-dialog`, `checkbox`, `command`, `input`, `input-group`, `label`, `radio-group`, `select`, `switch`, `textarea` |
| Navigation | `dropdown-menu`, `navigation-menu`, `tabs`                                                                            |
| Feedback   | `alert`, `badge`, `calendar`, `dialog`, `popover`, `progress`, `skeleton`, `tooltip`, `sonner`                        |
| Data       | `table`, `chart`                                                                                                      |
| Other      | `avatar`, `button`, `slider`                                                                                          |

### Hooks

#### `hooks/use-mobile.ts`

```ts
export function useIsMobile(): boolean
// Returns true when viewport < 768px
// Uses matchMedia — SSR-safe (undefined until mounted)
```

### Utilities

#### `lib/utils.ts`

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string
// Merge Tailwind classes — resolves conflicts correctly
// Usage: cn('p-4', isActive && 'bg-primary', className)
```

---

## Prisma (`packages/prisma/`)

### Structure

```
packages/prisma/
├── prisma/
│   ├── schema.prisma           # Source of truth — edit here only
│   ├── migrations/             # Migration history (committed)
│   └── generated/              # Auto-generated — DO NOT EDIT
└── src/
    ├── prisma.service.ts       # PrismaClient wrapper
    ├── prisma.module.ts        # @Global() NestJS module
    ├── index.ts                # Package exports
    └── generated/client/       # Prisma Client — DO NOT EDIT
```

### Schema

```prisma
generator client {
  provider   = "prisma-client"
  output     = "../src/generated/client"
  engineType = "client"
}

generator zod {
  provider = "prisma-zod-generator"  // Auto-generates Zod schemas
}

datasource db {
  provider = "postgresql"
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
```

### PrismaService

```ts
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    super({ adapter })
  }
  async onModuleInit() {
    await this.$connect()
  }
  async onModuleDestroy() {
    await this.$disconnect()
  }
}
```

### PrismaModule

`@Global()` — import **once** in `AppModule`, then inject `PrismaService` anywhere without re-importing.

```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

### Workflow

```bash
# After any schema.prisma change:
pnpm db:generate   # regenerate Prisma client
pnpm db:migrate    # run migrate dev (creates migration file + applies)

# Multi-step writes — always use transactions:
await prisma.$transaction([...])
```

---

## Coding Style — App Router Components

### Server vs Client

```
Default → Server Component (no directive needed)
Need useState / useEffect / event handlers → add 'use client'
Layouts → NEVER add 'use client' unless absolutely unavoidable
```

### Route Segment Files

Every route segment must have:

```
app/
└── some-route/
    ├── page.tsx      # Required
    ├── loading.tsx   # Required — shown during Suspense
    └── error.tsx     # Required — error boundary
```

### Component Template (Client)

```tsx
'use client'

import { useState } from 'react'
import { SomeComponent } from '@/components/ui/some-component'
import { cn } from '@/lib/utils'

interface MyComponentProps {
  title: string
  onAction?: () => void
}

export function MyComponent({ title, onAction }: MyComponentProps) {
  const [active, setActive] = useState(false)

  return (
    <div className={cn('flex items-center gap-3', active && 'bg-accent')}>
      {title}
    </div>
  )
}
```

### Component Template (Server)

```tsx
import { SomeComponent } from '@/components/ui/some-component'

interface MyPageProps {
  params: { id: string }
}

export default async function MyPage({ params }: MyPageProps) {
  const data = await fetch(`/api/items/${params.id}`, {
    next: { tags: ['item'] },
  }).then(r => r.json())

  return <SomeComponent data={data} />
}
```

### Styling Rules

| Rule                | Detail                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| Colors              | CSS variables only — `bg-primary`, `text-destructive`, `text-muted-foreground` |
| No hex              | Never hardcode `#fff`, `rgb(...)`                                              |
| Conditional classes | Always use `cn()`                                                              |
| Responsive          | Mobile-first: base → `sm:` (640px) → `lg:` (1024px)                            |
| Dark mode           | `dark:` variant or CSS variables (auto via `ThemeProvider`)                    |

### Data Fetching

```
Server data (static/ISR) → Next.js fetch() with revalidation tags
Client server state      → TanStack React Query (staleTime: 60s)
Complex client state     → Zustand
```

### Import Aliases

```ts
'@/'              → apps/client/ root
'@/components/ui' → shadcn components
'@/components'    → custom components
'@/lib/utils'     → cn() and utilities
'@/hooks'         → custom hooks
```

### No-Nos

- No `any` or `@ts-ignore` — zero tolerance
- No mock data — always connect to real Prisma/APIs
- Never edit `components/ui/**` — use `npx shadcn add`
- Never skip `pnpm db:migrate` after schema changes
