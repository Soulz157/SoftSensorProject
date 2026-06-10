import { useState, useEffect, useCallback } from 'react'
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

  const plans = STATIC_PLANS

  const fetchSubscription = useCallback(async () => {
    try {
      const subRes = await planService.mySubscription()
      setSubscription(subRes.data ?? null)
    } catch {
      // Handle error quietly as per original logic
    }
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

  const handleSelectPlan = async (plan: PlanInfo) => {
    if (plan.name === 'ENTERPRISE') {
      toast.info('Contacting sales team...')
      // e.g. window.location.href = 'mailto:sales@example.com'
      setSubscription(prev => ({
        ...(prev as SubscriptionInfo),
        status: 'ACTIVE',
        plan: {
          ...plan,
          description: plan.name,
        },
      }))
      return
    }

    toast.info(`Selected ${plan.name} plan. Ready to map in backend.`)
    // TODO: ส่ง Request ไปที่ Backend เพื่อบันทึก Plan
    // await planService.subscribeToPlan(plan.id)
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
