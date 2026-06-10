'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Check, X, CreditCard, AlertTriangle } from 'lucide-react'

import { usePlans } from '@/hooks/user/use-plan'
import {
  FEATURES,
  PLAN_META,
  formatPrice,
  formatPeriod,
  type PlanKey,
} from '@/constants/plans'

function FeatureCell({
  value,
  planKey,
}: {
  value: string | boolean
  planKey: PlanKey
}) {
  const checkColor =
    planKey === 'PRO'
      ? 'text-blue-400'
      : planKey === 'ENTERPRISE'
        ? 'text-violet-400'
        : planKey === 'STANDARD'
          ? 'text-emerald-400'
          : 'text-muted-foreground'

  if (value === true)
    return (
      <Check className={cn('h-4 w-4 mx-auto dark:text-white', checkColor)} />
    )
  if (value === false)
    return <X className="h-4 w-4 mx-auto dark:text-white/30" />

  return <span className={cn('text-xs font-medium', checkColor)}>{value}</span>
}

function PlansSkeleton() {
  return (
    <div className="flex flex-col gap-8 p-6 max-w-5xl mx-auto w-full">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-52 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function PlansPage() {
  // ดึง Logic และ State ทั้งหมดมาจาก Hook
  const {
    plans,
    loading,
    isDowngrading,
    currentPlanName,
    isExpired,
    handleDowngrade,
    handleSelectPlan,
  } = usePlans()

  if (loading) return <PlansSkeleton />

  return (
    <div className="flex flex-col gap-8 p-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <CreditCard className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">
            Plans &amp; Billing
          </h1>
        </div>
        <p className="text-sm text-muted-foreground ">
          {currentPlanName ? (
            <>
              You are on the{' '}
              <span className="font-medium text-foreground">
                {currentPlanName}
              </span>{' '}
              plan
            </>
          ) : (
            'No active plan'
          )}
        </p>
      </div>

      {/* Expired banner */}
      {isExpired && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm font-medium text-amber-400">
            Your plan has expired — upgrade to continue using premium features.
          </p>
        </div>
      )}

      {/* Pricing cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
        {plans.map(plan => {
          const meta = PLAN_META[plan.name as PlanKey]
          if (!meta) return null

          const isCurrent = plan.name === currentPlanName
          const IconComponent = meta.icon // Render icon dynamically

          return (
            <div
              key={plan.id}
              className={cn(
                'relative rounded-xl border p-6 w-full flex flex-col gap-5 transition-all',
                meta.highlighted
                  ? 'border-blue-500/30 shadow-[0_0_40px_-8px_rgba(59,130,246,0.3)] bg-blue-950/10'
                  : 'border-border bg-card/50',
              )}
            >
              {meta.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-1 text-[11px] font-semibold text-white whitespace-nowrap">
                  {meta.badge}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  <IconComponent
                    className={cn(
                      'h-5 w-5',
                      plan.name === 'FREE' && 'text-amber-400',
                      plan.name === 'STANDARD' && 'text-blue-400',
                      plan.name === 'PRO' && 'text-emerald-400',
                      plan.name === 'ENTERPRISE' && 'text-violet-400',
                    )}
                  />
                  <span className="font-semibold text-sm">{plan.name}</span>
                  {isCurrent && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
                      Current
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold tracking-tight">
                    {formatPrice(plan)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatPeriod(plan)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {meta.description}
                </p>
              </div>

              <Button
                variant={isCurrent ? 'outline' : meta.ctaVariant}
                disabled={isCurrent}
                onClick={() => handleSelectPlan(plan)}
                className={cn(
                  'w-full text-sm',
                  meta.highlighted &&
                    !isCurrent &&
                    'bg-blue-500 hover:bg-blue-600 text-white border-0',
                )}
              >
                {isCurrent ? 'Current Plan' : meta.cta}
              </Button>
            </div>
          )
        })}
      </div>

      {/* Feature comparison table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-5 bg-muted/40 border-b border-border">
          <div className="px-4 py-3 text-xs font-medium text-muted-foreground">
            Feature
          </div>
          {plans.map(plan => {
            const meta = PLAN_META[plan.name as PlanKey]
            return (
              <div
                key={plan.id}
                className={cn(
                  'px-4 py-3 text-center text-xs font-semibold',
                  meta?.highlighted
                    ? 'text-blue-400 bg-blue-950/20'
                    : 'text-foreground',
                )}
              >
                {plan.name}
              </div>
            )
          })}
        </div>

        {FEATURES.map((feature, i) => (
          <div
            key={feature.label}
            className={cn(
              'grid grid-cols-5 border-b border-border/50 last:border-0',
              i % 2 === 0 ? 'bg-background' : 'bg-muted/20',
            )}
          >
            <div className="px-4 py-3 text-xs text-muted-foreground flex items-center">
              {feature.label}
            </div>
            {plans.map(plan => {
              const meta = PLAN_META[plan.name as PlanKey]
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'px-4 py-3 flex items-center justify-center',
                    meta?.highlighted && 'bg-blue-950/10',
                  )}
                >
                  <FeatureCell
                    value={feature[plan.name as PlanKey]}
                    planKey={plan.name as PlanKey}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Downgrade link */}
      {currentPlanName && currentPlanName !== 'FREE' && !isExpired && (
        <div className="text-center">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={isDowngrading}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50 cursor-pointer"
              >
                {isDowngrading ? 'Downgrading…' : 'Downgrade to FREE'}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Downgrade to FREE?</AlertDialogTitle>
                <AlertDialogDescription>
                  You will immediately lose access to{' '}
                  <span className="font-medium text-foreground">
                    {currentPlanName}
                  </span>{' '}
                  features.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current plan</AlertDialogCancel>
                <AlertDialogAction onClick={handleDowngrade}>
                  Downgrade to FREE
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pb-4">
        All plans include SSL encryption and 99.9% uptime SLA. Cancel anytime.
      </p>
    </div>
  )
}
