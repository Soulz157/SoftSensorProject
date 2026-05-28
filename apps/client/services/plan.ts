import { fetchClient } from '@/lib/fetcher'
import type { PlanInfo, SubscriptionInfo } from '@/types'

export const planService = {
  listPlans: (): Promise<{ data: PlanInfo[] }> =>
    fetchClient('/api/v1/authorized/plan', { method: 'GET' }),

  mySubscription: (): Promise<{ data: SubscriptionInfo | null }> =>
    fetchClient('/api/v1/authorized/plan/subscription', { method: 'GET' }),

  adminListPlans: (): Promise<{ data: PlanInfo[] }> =>
    fetchClient('/api/v1/admin/plan', { method: 'GET' }),

  adminAssignPlan: (userId: string, planId: string): Promise<unknown> =>
    fetchClient(`/api/v1/admin/plan/user/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ planId }),
    }),

  downgrade: (): Promise<unknown> =>
    fetchClient('/api/v1/authorized/plan/downgrade', { method: 'POST' }),
}
