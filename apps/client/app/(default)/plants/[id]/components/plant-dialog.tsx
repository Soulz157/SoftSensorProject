import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState } from 'react'

export function AddPlanDialog({
  open,
  onClose,
  workspaceName,
  onAddPlan,
}: {
  open: boolean
  onClose: () => void
  workspaceName: string
  onAddPlan: (name: string) => void
}) {
  const [planName, setPlanName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!planName.trim()) return
    onAddPlan(planName)
    setPlanName('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle>Add Sub-company (Plant)</DialogTitle>
          <DialogDescription>
            Create a new plant or sub-company under{' '}
            <strong>{workspaceName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="plan-name" className="text-right">
              Name
            </Label>
            <Input
              id="plan-name"
              placeholder="e.g., Factory B, Zone 3"
              value={planName}
              onChange={e => setPlanName(e.target.value)}
              className="col-span-3"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create Plant</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
