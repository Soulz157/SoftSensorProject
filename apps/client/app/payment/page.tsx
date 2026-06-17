'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STATIC_PLANS } from '@/constants/plans'
import { useCheckout } from '@/hooks/user/use-checkout'
import { CheckoutSummary } from './components/checkout-summary'
import { BillingForm } from './components/billing-form'

function Checkout() {
  const params = useSearchParams()
  const requested = (params.get('plan') ?? 'STANDARD').toUpperCase()
  const plan =
    STATIC_PLANS.find(p => p.name === requested) ??
    STATIC_PLANS.find(p => p.name === 'STANDARD')

  const { data: session } = useSession()
  const email = session?.user?.email ?? ''
  const { submitting, subscribe } = useCheckout()

  if (!plan) {
    return <p className="text-sm text-muted-foreground">No plans available.</p>
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <BillingForm email={email} />
      <CheckoutSummary
        plan={plan}
        submitting={submitting}
        onSubmit={() => subscribe(plan.name)}
      />
    </div>
  )
}

export default function PaymentPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground">
              S
            </div>
            <div>
              <p className="font-semibold leading-tight">SoftSensor</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Secure Checkout
              </p>
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings?tab=plans">
              <ArrowLeft className="h-4 w-4" /> Back to Plans
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Suspense
          fallback={
            <div className="text-sm text-muted-foreground">
              Loading checkout…
            </div>
          }
        >
          <Checkout />
        </Suspense>
      </main>
    </div>
  )
}
