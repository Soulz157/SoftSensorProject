'use client'

import { AppLayout } from '@/components/app-layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, X, Zap, Building2, Sparkles, CreditCard } from 'lucide-react'

interface PlanFeature {
  label: string
  starter: string | boolean
  professional: string | boolean
  enterprise: string | boolean
}

const FEATURES: PlanFeature[] = [
  {
    label: 'Active Models',
    starter: 'Up to 5',
    professional: 'Up to 20',
    enterprise: 'Unlimited',
  },
  {
    label: 'Data History',
    starter: '7 days',
    professional: '90 days',
    enterprise: 'Unlimited',
  },
  {
    label: 'Custom Import',
    starter: false,
    professional: true,
    enterprise: true,
  },
  { label: 'API Access', starter: false, professional: true, enterprise: true },
  {
    label: 'Team Members',
    starter: '1',
    professional: 'Up to 10',
    enterprise: 'Unlimited',
  },
  {
    label: 'Priority Support',
    starter: false,
    professional: 'Email',
    enterprise: 'Dedicated',
  },
  {
    label: 'Analytics Export',
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    label: 'SSO / SAML',
    starter: false,
    professional: false,
    enterprise: true,
  },
]

interface Plan {
  id: 'starter' | 'professional' | 'enterprise'
  name: string
  price: string
  period: string
  description: string
  current: boolean
  highlighted: boolean
  badge?: string
  icon: React.ReactNode
  cta: string
  ctaVariant: 'outline' | 'default' | 'secondary'
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$0',
    period: 'forever',
    description: 'For individuals exploring soft sensor modeling',
    current: true,
    highlighted: false,
    icon: <Zap className="h-5 w-5 text-amber-400" />,
    cta: 'Current Plan',
    ctaVariant: 'outline',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '$49',
    period: 'per month',
    description: 'For teams running production sensor pipelines',
    current: false,
    highlighted: true,
    badge: 'Most Popular',
    icon: <Sparkles className="h-5 w-5 text-blue-400" />,
    cta: 'Upgrade to Pro',
    ctaVariant: 'default',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'contact us',
    description: 'Unlimited scale with dedicated support',
    current: false,
    highlighted: false,
    icon: <Building2 className="h-5 w-5 text-violet-400" />,
    cta: 'Contact Sales',
    ctaVariant: 'secondary',
  },
]

function FeatureCell({
  value,
  tier,
}: {
  value: string | boolean
  tier: 'starter' | 'professional' | 'enterprise'
}) {
  const checkColor =
    tier === 'professional'
      ? 'text-blue-400'
      : tier === 'enterprise'
        ? 'text-violet-400'
        : 'text-muted-foreground'

  if (value === true) {
    return (
      <Check className={cn('h-4 w-4 mx-auto dark:text-white', checkColor)} />
    )
  }
  if (value === false) {
    return <X className="h-4 w-4 mx-auto dark:text-white/30" />
  }
  return (
    <span
      className={cn(
        'text-xs font-medium',
        tier === 'professional'
          ? 'text-blue-400'
          : tier === 'enterprise'
            ? 'text-violet-400'
            : 'text-muted-foreground',
      )}
    >
      {value}
    </span>
  )
}

export default function PlansPage() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-8 p-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">
              Plans & Billing
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            You are on the{' '}
            <span className="font-medium text-amber-400">Starter</span> plan · 4
            of 5 active models used
          </p>
        </div>

        {/* Current usage banner */}
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="h-4 w-4 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-medium">Approaching model limit</p>
              <p className="text-xs text-muted-foreground">
                4 / 5 active models · 1 slot remaining
              </p>
            </div>
          </div>
          <div className="w-32 h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-400"
              style={{ width: '80%' }}
            />
          </div>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-xl border p-6 flex flex-col gap-5 transition-all',
                plan.highlighted
                  ? 'border-blue-500/30 shadow-[0_0_40px_-8px_rgba(59,130,246,0.3)] bg-blue-950/10'
                  : 'border-border bg-card/50',
              )}
            >
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-1 text-[11px] font-semibold text-white whitespace-nowrap">
                  {plan.badge}
                </div>
              )}

              {/* Plan header */}
              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  {plan.icon}
                  <span className="font-semibold text-sm">{plan.name}</span>
                  {plan.current && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
                      Current
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">
                    {plan.price}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {plan.period}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {plan.description}
                </p>
              </div>

              {/* CTA */}
              <Button
                variant={plan.ctaVariant}
                disabled={plan.current}
                className={cn(
                  'w-full text-sm',
                  plan.highlighted &&
                    !plan.current &&
                    'bg-blue-500 hover:bg-blue-600 text-white border-0',
                )}
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>

        {/* Feature comparison table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-4 bg-muted/40 border-b border-border">
            <div className="px-4 py-3 text-xs font-medium text-muted-foreground">
              Feature
            </div>
            {PLANS.map(plan => (
              <div
                key={plan.id}
                className={cn(
                  'px-4 py-3 text-center text-xs font-semibold',
                  plan.highlighted
                    ? 'text-blue-400 bg-blue-950/20'
                    : 'text-foreground',
                )}
              >
                {plan.name}
              </div>
            ))}
          </div>

          {/* Feature rows */}
          {FEATURES.map((feature, i) => (
            <div
              key={feature.label}
              className={cn(
                'grid grid-cols-4 border-b border-border/50 last:border-0',
                i % 2 === 0 ? 'bg-background' : 'bg-muted/20',
              )}
            >
              <div className="px-4 py-3 text-xs text-muted-foreground flex items-center">
                {feature.label}
              </div>
              {PLANS.map(plan => (
                <div
                  key={plan.id}
                  className={cn(
                    'px-4 py-3 flex items-center justify-center',
                    plan.highlighted && 'bg-blue-950/10',
                  )}
                >
                  <FeatureCell value={feature[plan.id]} tier={plan.id} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center pb-4">
          All plans include SSL encryption and 99.9% uptime SLA. Cancel anytime.
        </p>
      </div>
    </AppLayout>
  )
}
