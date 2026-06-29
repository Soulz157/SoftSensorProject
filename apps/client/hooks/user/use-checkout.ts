import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { planService } from '@/services/plan'

/**
 * Simulated checkout: no real charge. On submit it calls the backend
 * subscribe endpoint (which swaps the user's active subscription) and returns
 * to the Plans tab. Swap `subscribeToPlan` for a real payment-provider session
 * when one is configured.
 */
export function useCheckout() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const subscribe = async (planName: string) => {
    setSubmitting(true)
    try {
      await planService.subscribeToPlan(planName)
      toast.success(`Subscribed to the ${planName} plan`)
      router.push('/settings?tab=plans')
    } catch {
      toast.error('Payment failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, subscribe }
}
