# Subscription Plans (FREE / STANDARD / PRO / ENTERPRISE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add STANDARD tier between FREE and PRO; update PRO price $49 → $19; wire all four plans into the frontend pricing UI.

**Architecture:** Seed-only data change (no schema migration). Backend API is already generic — `listPlans()` returns all plans sorted by price. Frontend `plans.tsx` has hardcoded `PLAN_META` and `FEATURES` keyed by plan name; we extend both to include STANDARD.

**Tech Stack:** Prisma seed (TypeScript), Next.js 16 App Router, Vitest + @testing-library/react.

---

## File Map

| File                                                                     | Action | Purpose                                                                             |
| ------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `packages/prisma/prisma/seed.ts`                                         | Modify | Add STANDARD plan; update PRO price to $19                                          |
| `apps/client/app/(default)/settings/components/plans.tsx`                | Modify | Add STANDARD to PlanKey, PLAN_META, PlanFeature, FEATURES; update grid/table layout |
| `apps/client/app/(default)/settings/components/__tests__/plans.test.tsx` | Create | Vitest component test verifying all 4 plan names render                             |

---

## Task 1: Update Seed Data

**Files:**

- Modify: `packages/prisma/prisma/seed.ts`

- [ ] **Step 1: Write the failing test (manual verification baseline)**

Run the current seed and confirm only 3 plans exist:

```bash
cd /path/to/project
pnpm db:migrate:dev  # ensure DB is up to date
```

Then open Prisma Studio or run:

```bash
pnpm --filter prisma exec -- npx prisma studio
```

Confirm only FREE / PRO / ENTERPRISE rows exist in the `Plan` table.

- [ ] **Step 2: Update `packages/prisma/prisma/seed.ts`**

Replace the `PLANS` array:

```ts
const PLANS = [
  { name: 'FREE', price: 0, maxWorkspaces: 1, durationMonths: 1 },
  { name: 'STANDARD', price: 8, maxWorkspaces: 3, durationMonths: 1 },
  { name: 'PRO', price: 19, maxWorkspaces: 10, durationMonths: 1 },
  { name: 'ENTERPRISE', price: null, maxWorkspaces: 999, durationMonths: 1 },
]
```

The full file after the change:

```ts
import 'dotenv/config'
import { PrismaClient } from '../src/generated/client/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const PLANS = [
  { name: 'FREE', price: 0, maxWorkspaces: 1, durationMonths: 1 },
  { name: 'STANDARD', price: 8, maxWorkspaces: 3, durationMonths: 1 },
  { name: 'PRO', price: 19, maxWorkspaces: 10, durationMonths: 1 },
  { name: 'ENTERPRISE', price: null, maxWorkspaces: 999, durationMonths: 1 },
]

async function main() {
  console.log('Seeding plans…')
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: { price: plan.price, maxWorkspaces: plan.maxWorkspaces },
      create: plan,
    })
    console.log(`  ✓ ${plan.name}`)
  }
  console.log('Plans seeded ✓')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Run the seed**

```bash
pnpm --filter prisma db:seed
```

Expected output:

```
Seeding plans…
  ✓ FREE
  ✓ STANDARD
  ✓ PRO
  ✓ ENTERPRISE
Plans seeded ✓
```

If `db:seed` script is not defined in `packages/prisma/package.json`, run directly:

```bash
dotenvx run -- npx ts-node packages/prisma/prisma/seed.ts
```

- [ ] **Step 4: Verify in DB**

Confirm 4 rows exist with correct prices:

- FREE: $0, maxWorkspaces: 1
- STANDARD: $8, maxWorkspaces: 3
- PRO: $19, maxWorkspaces: 10
- ENTERPRISE: null, maxWorkspaces: 999

- [ ] **Step 5: Commit**

```bash
git add packages/prisma/prisma/seed.ts
git commit -m "feat(plans): add STANDARD tier and update PRO price to $19"
```

---

## Task 2: Write Failing Frontend Test

**Files:**

- Create: `apps/client/app/(default)/settings/components/__tests__/plans.test.tsx`

- [ ] **Step 1: Create test file**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlansPage from '../plans'

vi.mock('@/services/plan', () => ({
  planService: {
    listPlans: vi.fn(),
    mySubscription: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const mockPlans = [
  { id: '1', name: 'FREE', price: 0, maxWorkspaces: 1, durationMonths: 1 },
  { id: '2', name: 'STANDARD', price: 8, maxWorkspaces: 3, durationMonths: 1 },
  { id: '3', name: 'PRO', price: 19, maxWorkspaces: 10, durationMonths: 1 },
  {
    id: '4',
    name: 'ENTERPRISE',
    price: null,
    maxWorkspaces: 999,
    durationMonths: 1,
  },
]

describe('PlansPage', () => {
  beforeEach(async () => {
    const { planService } = await import('@/services/plan')
    vi.mocked(planService.listPlans).mockResolvedValue({
      data: mockPlans,
    } as never)
    vi.mocked(planService.mySubscription).mockResolvedValue({
      data: null,
    } as never)
  })

  it('renders all four plan names', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('FREE')).toBeTruthy()
    expect(await screen.findByText('STANDARD')).toBeTruthy()
    expect(await screen.findByText('PRO')).toBeTruthy()
    expect(await screen.findByText('ENTERPRISE')).toBeTruthy()
  })

  it('renders STANDARD price as $8', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('$8')).toBeTruthy()
  })

  it('renders PRO price as $19', async () => {
    render(<PlansPage />)
    expect(await screen.findByText('$19')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter client test -- --testPathPatterns=plans.test
```

Expected: FAIL — `STANDARD` not found (not yet in PLAN_META so component returns null for it).

---

## Task 3: Update Frontend `plans.tsx`

**Files:**

- Modify: `apps/client/app/(default)/settings/components/plans.tsx`

- [ ] **Step 1: Add `Star` to lucide-react import**

Current import line (top of file):

```tsx
import {
  Check,
  X,
  Zap,
  Building2,
  Sparkles,
  CreditCard,
  AlertTriangle,
} from 'lucide-react'
```

Replace with:

```tsx
import {
  Check,
  X,
  Zap,
  Star,
  Building2,
  Sparkles,
  CreditCard,
  AlertTriangle,
} from 'lucide-react'
```

- [ ] **Step 2: Add `STANDARD` to `PlanFeature` interface**

Current:

```tsx
interface PlanFeature {
  label: string
  FREE: string | boolean
  PRO: string | boolean
  ENTERPRISE: string | boolean
}
```

Replace with:

```tsx
interface PlanFeature {
  label: string
  FREE: string | boolean
  STANDARD: string | boolean
  PRO: string | boolean
  ENTERPRISE: string | boolean
}
```

- [ ] **Step 3: Update `FEATURES` array — add STANDARD column**

Replace the entire `FEATURES` constant:

```tsx
const FEATURES: PlanFeature[] = [
  {
    label: 'Active Models',
    FREE: 'Up to 5',
    STANDARD: 'Up to 10',
    PRO: 'Up to 20',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Data History',
    FREE: '7 days',
    STANDARD: '30 days',
    PRO: '90 days',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Custom Import',
    FREE: false,
    STANDARD: false,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'API Access',
    FREE: false,
    STANDARD: false,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'Team Members',
    FREE: 'Up to 5',
    STANDARD: 'Up to 10',
    PRO: 'Up to 20',
    ENTERPRISE: 'Unlimited',
  },
  {
    label: 'Priority Support',
    FREE: false,
    STANDARD: 'Email',
    PRO: 'Email',
    ENTERPRISE: 'Dedicated',
  },
  {
    label: 'Analytics Export',
    FREE: false,
    STANDARD: true,
    PRO: true,
    ENTERPRISE: true,
  },
  {
    label: 'SSO / SAML',
    FREE: false,
    STANDARD: false,
    PRO: false,
    ENTERPRISE: true,
  },
]
```

- [ ] **Step 4: Update `PlanKey` type**

Current:

```tsx
type PlanKey = 'FREE' | 'PRO' | 'ENTERPRISE'
```

Replace with:

```tsx
type PlanKey = 'FREE' | 'STANDARD' | 'PRO' | 'ENTERPRISE'
```

- [ ] **Step 5: Add STANDARD entry to `PLAN_META`**

Current `PLAN_META` object (the declaration):

```tsx
const PLAN_META: Record<
  PlanKey,
  {
    icon: React.ReactNode
    description: string
    badge?: string
    highlighted: boolean
    cta: string
    ctaVariant: 'outline' | 'default' | 'secondary'
  }
> = {
  FREE: {
```

Replace the entire `PLAN_META` constant:

```tsx
const PLAN_META: Record<
  PlanKey,
  {
    icon: React.ReactNode
    description: string
    badge?: string
    highlighted: boolean
    cta: string
    ctaVariant: 'outline' | 'default' | 'secondary'
  }
> = {
  FREE: {
    icon: <Zap className="h-5 w-5 text-amber-400" />,
    description: 'For individuals exploring soft sensor modeling',
    highlighted: false,
    cta: 'Current Plan',
    ctaVariant: 'outline',
  },
  STANDARD: {
    icon: <Star className="h-5 w-5 text-emerald-400" />,
    description: 'For small teams managing multiple sensor pipelines',
    highlighted: false,
    cta: 'Upgrade to Standard',
    ctaVariant: 'default',
  },
  PRO: {
    icon: <Sparkles className="h-5 w-5 text-blue-400" />,
    description: 'For teams running production sensor pipelines',
    badge: 'Most Popular',
    highlighted: true,
    cta: 'Upgrade to Pro',
    ctaVariant: 'default',
  },
  ENTERPRISE: {
    icon: <Building2 className="h-5 w-5 text-violet-400" />,
    description: 'Unlimited scale with dedicated support',
    highlighted: false,
    cta: 'Contact Sales',
    ctaVariant: 'secondary',
  },
}
```

- [ ] **Step 6: Update pricing cards grid from 3-col to 4-col**

Find this JSX in `PlansPage`:

```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
```

Replace with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
```

- [ ] **Step 7: Update feature comparison table from 4-col to 5-col**

Find this in the feature comparison section:

```tsx
<div className="grid grid-cols-4 bg-muted/40 border-b border-border">
```

Replace with:

```tsx
<div className="grid grid-cols-5 bg-muted/40 border-b border-border">
```

Find the feature row grid:

```tsx
className={cn(
  'grid grid-cols-4 border-b border-border/50 last:border-0',
```

Replace with:

```tsx
className={cn(
  'grid grid-cols-5 border-b border-border/50 last:border-0',
```

- [ ] **Step 8: Update `PlansSkeleton` grid to match**

Find:

```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-5">
```

Replace with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
```

And the skeleton count from 3 to 4:

```tsx
{[0, 1, 2].map(i => (
```

Replace with:

```tsx
{[0, 1, 2, 3].map(i => (
```

---

## Task 4: Verify Tests Pass

**Files:**

- Test: `apps/client/app/(default)/settings/components/__tests__/plans.test.tsx`

- [ ] **Step 1: Run the tests**

```bash
pnpm --filter client test -- --testPathPatterns=plans.test
```

Expected output:

```
✓ renders all four plan names
✓ renders STANDARD price as $8
✓ renders PRO price as $19
```

- [ ] **Step 2: Run full client test suite to check for regressions**

```bash
pnpm --filter client test
```

Expected: all existing tests still pass.

---

## Task 5: Format, Build, Commit

- [ ] **Step 1: Format**

```bash
pnpm format
```

Expected: no errors, files reformatted in place.

- [ ] **Step 2: Full build**

```bash
pnpm build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/client/app/(default)/settings/components/plans.tsx \
        apps/client/app/(default)/settings/components/__tests__/plans.test.tsx
git commit -m "feat(plans): add STANDARD tier to pricing UI (4-plan grid)"
```
