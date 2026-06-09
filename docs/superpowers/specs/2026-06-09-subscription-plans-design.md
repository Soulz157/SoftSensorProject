# Subscription Plans: FREE / STANDARD / PRO / ENTERPRISE

**Date:** 2026-06-09
**Scope:** Seed data + frontend UI only. No schema/API changes.

---

## Goal

Add a STANDARD tier between FREE and PRO. Update PRO pricing from $49 to $19.

---

## Plan Data

| Name       | Price         | maxWorkspaces | durationMonths |
| ---------- | ------------- | ------------- | -------------- |
| FREE       | $0            | 1             | 1              |
| STANDARD   | $8            | 3             | 1              |
| PRO        | $19           | 10            | 1              |
| ENTERPRISE | null (custom) | 999           | 1              |

Upserted via `packages/prisma/prisma/seed.ts`. PRO price update handled by `upsert.update`.

---

## Frontend Changes (`apps/client/app/(default)/settings/components/plans.tsx`)

### Types

```ts
type PlanKey = 'FREE' | 'STANDARD' | 'PRO' | 'ENTERPRISE'
```

`PlanFeature` interface gains `STANDARD` column.

### PLAN_META (new STANDARD entry)

```ts
STANDARD: {
  icon: <Star className="h-5 w-5 text-emerald-400" />,
  description: 'For small teams managing multiple sensor pipelines',
  highlighted: false,
  cta: 'Upgrade to Standard',
  ctaVariant: 'default',
}
```

PRO stays highlighted (best value). No badge changes.

### Feature Matrix

| Feature          | FREE    | STANDARD | PRO      | ENTERPRISE |
| ---------------- | ------- | -------- | -------- | ---------- |
| Active Models    | Up to 5 | Up to 10 | Up to 20 | Unlimited  |
| Data History     | 7 days  | 30 days  | 90 days  | Unlimited  |
| Custom Import    | false   | false    | true     | true       |
| API Access       | false   | false    | true     | true       |
| Team Members     | Up to 5 | Up to 10 | Up to 20 | Unlimited  |
| Priority Support | false   | Email    | Email    | Dedicated  |
| Analytics Export | false   | true     | true     | true       |
| SSO / SAML       | false   | false    | false    | true       |

### Layout

- Pricing cards: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
- Feature comparison table: `grid-cols-5` (Feature label + 4 plan columns)

---

## Out of Scope

- No schema changes
- No new backend endpoints
- No payment/billing integration
- No admin UI for plan management (plans managed via seed only)

---

## Files Changed

1. `packages/prisma/prisma/seed.ts` — add STANDARD, update PRO price
2. `apps/client/app/(default)/settings/components/plans.tsx` — add STANDARD tier throughout
