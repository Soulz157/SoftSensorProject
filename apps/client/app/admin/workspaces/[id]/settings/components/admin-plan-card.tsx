'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CreditCard, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { planService } from '@/services/plan'
import type { PlanInfo } from '@/types'

export function AdminPlanCard({ ownerUserId }: { ownerUserId?: string }) {
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [planId, setPlanId] = useState('')
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    planService
      .adminListPlans()
      .then(res => setPlans(res.data))
      .catch(() => {})
  }, [])

  const assign = async () => {
    if (!ownerUserId || !planId) return
    setAssigning(true)
    try {
      await planService.adminAssignPlan(ownerUserId, planId)
      toast.success('Plan assigned to workspace owner')
    } catch {
      toast.error('Failed to assign plan')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <CreditCard className="h-4 w-4 text-primary" />
          Subscription Plan
        </CardTitle>
        <CardDescription>
          Assign a subscription plan to the workspace owner.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={planId}
          onValueChange={setPlanId}
          disabled={!ownerUserId || plans.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={ownerUserId ? 'Select a plan' : 'No owner found'}
            />
          </SelectTrigger>
          <SelectContent>
            {plans.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.price != null ? ` — $${p.price}/mo` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="w-full gap-2"
          onClick={assign}
          disabled={!ownerUserId || !planId || assigning}
        >
          {assigning && <Loader2 className="h-4 w-4 animate-spin" />}
          Assign to owner
        </Button>
      </CardContent>
    </Card>
  )
}
