import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { planService } from '@/services/plan'
import type { PlanInfo, SubscriptionInfo } from '@/types'
import { STATIC_PLANS } from '@/constants/plans'

export function usePlans() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [isDowngrading, setIsDowngrading] = useState(false)
  const router = useRouter()

  const plans = STATIC_PLANS

  const fetchSubscription = useCallback(async () => {
    try {
      const subRes = await planService.mySubscription()
      setSubscription(subRes.data ?? null)
    } catch {}
  }, [])

  useEffect(() => {
    let mounted = true
    const init = async () => {
      setLoading(true)
      await fetchSubscription()
      if (mounted) setLoading(false)
    }
    init()
    return () => {
      mounted = false
    }
  }, [fetchSubscription])

  // Logic สำหรับการ Downgrade
  const handleDowngrade = async () => {
    setIsDowngrading(true)
    try {
      await planService.downgrade()
      toast.success('Downgraded to FREE plan')
      await fetchSubscription() // Refresh status
    } catch {
      toast.error('Failed to downgrade plan')
    } finally {
      setIsDowngrading(false)
    }
  }

  const handleSelectPlan = (plan: PlanInfo) => {
    if (plan.name === 'ENTERPRISE') {
      toast.info('Contacting sales team…')
      return
    }
    if (plan.name === 'FREE') {
      // FREE has its own flow (cancel paid plan), not a $0 checkout.
      void handleDowngrade()
      return
    }
    // Paid plans go through the checkout page, which persists on submit.
    router.push(`/payment?plan=${encodeURIComponent(plan.name)}`)
  }

  const currentPlanName = subscription?.plan?.name ?? null
  const isExpired = subscription?.status === 'EXPIRED'

  return {
    plans,
    subscription,
    loading,
    isDowngrading,
    currentPlanName,
    isExpired,
    handleDowngrade,
    handleSelectPlan,
  }
}
