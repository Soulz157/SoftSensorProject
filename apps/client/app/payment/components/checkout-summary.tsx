'use client'

import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { FEATURES, PLAN_META, type PlanKey } from '@/constants/plans'
import type { PlanInfo } from '@/types'

interface Props {
  plan: PlanInfo
  submitting: boolean
  onSubmit: () => void
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  )
}

export function CheckoutSummary({ plan, submitting, onSubmit }: Props) {
  const key = plan.name as PlanKey
  const meta = PLAN_META[key]
  const price = plan.price ?? 0
  const tax = Math.round(price * 0.07)
  const total = price + tax

  const includes = FEATURES.filter(f => {
    const v = f[key]
    return v === true || typeof v === 'string'
  }).slice(0, 4)

  return (
    <Card className="lg:sticky lg:top-6">
      <CardContent className="space-y-5 p-6">
        <Badge variant="secondary" className="uppercase tracking-wider">
          {plan.name} plan
        </Badge>
        {meta?.description && (
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        )}

        <Separator />

        <div className="space-y-2">
          <Row label={`${plan.name} (monthly)`} value={`$${price}`} />
          <Row label="Tax (7%)" value={`$${tax}`} />
        </div>

        <Separator />

        <div className="flex items-end justify-between">
          <span className="text-base font-semibold">Total due</span>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold tabular-nums">
              ${total}
            </div>
            <div className="text-xs text-muted-foreground">/ month</div>
          </div>
        </div>

        <ul className="space-y-2">
          {includes.map(f => {
            const v = f[key]
            return (
              <li
                key={f.label}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                {f.label}
                {typeof v === 'string' ? `: ${v}` : ''}
              </li>
            )
          })}
        </ul>

        <Button className="w-full" disabled={submitting} onClick={onSubmit}>
          {submitting ? 'Processing…' : `Subscribe & Pay $${total}`}
        </Button>

        <div className="flex justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> SSL Encrypted
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" /> PCI-DSS
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
