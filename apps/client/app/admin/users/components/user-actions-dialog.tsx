'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Loader2, ShieldOff, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSession } from 'next-auth/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Button } from '@/components/ui/button'
import { userService } from '@/services/user'
import { planService } from '@/services/plan'
import type { AdminUser, PlanInfo, UserRole } from '@/types'

interface UserActionsDialogProps {
  user: AdminUser
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const ROLES: UserRole[] = ['USER', 'ADMIN']

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export function UserActionsDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: UserActionsDialogProps) {
  const { data: session } = useSession()
  const isSelf = session?.user?.id === user.id

  const [role, setRole] = useState<UserRole>(user.role)
  const [isSavingRole, setIsSavingRole] = useState(false)
  const [isBlocking, setIsBlocking] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [planId, setPlanId] = useState<string>(
    user.subscriptions?.[0]?.plan?.id ?? '',
  )
  const [isSavingPlan, setIsSavingPlan] = useState(false)
  const currentPlanName = user.subscriptions?.[0]?.plan?.name ?? null

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || '—'
  const isBlocked = !!user.blockedAt
  const isDeleted = !!user.deletedAt

  useEffect(() => {
    if (!open) return
    planService
      .adminListPlans()
      .then(res => {
        setPlans(res.data ?? [])
      })
      .catch(() => {})
  }, [open])

  async function handleSaveRole() {
    if (role === user.role) {
      toast.info('No change in role')
      return
    }
    setIsSavingRole(true)
    try {
      await userService.updateUserRole(user.id, role)
      toast.success(`Role updated to ${role}`)
      onSuccess()
    } catch {
      toast.error('Failed to update role')
    } finally {
      setIsSavingRole(false)
    }
  }

  async function handleSavePlan() {
    if (!planId) return
    setIsSavingPlan(true)
    try {
      await planService.adminAssignPlan(user.id, planId)
      const selected = plans.find(p => p.id === planId)
      toast.success(`Plan changed to ${selected?.name ?? planId}`)
      onSuccess()
    } catch {
      toast.error('Failed to update plan')
    } finally {
      setIsSavingPlan(false)
    }
  }

  async function handleToggleBlock() {
    setIsBlocking(true)
    try {
      await userService.toggleBlockUser(user.id)
      toast.success(isBlocked ? 'User unblocked' : 'User blocked')
      onSuccess()
    } catch {
      toast.error('Failed to update block status')
    } finally {
      setIsBlocking(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await userService.deleteUser(user.id)
      toast.success('User deleted')
      onSuccess()
    } catch {
      toast.error('Failed to delete user')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
          <DialogDescription>
            Manage role, plan, block status, or remove this user.
          </DialogDescription>
        </DialogHeader>

        {/* User info */}
        <div className="rounded-md bg-muted/50 px-3 py-2.5 space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Account
          </p>
          <p className="text-sm font-medium text-foreground">{fullName}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground">
            Joined{' '}
            {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
            {' · '}
            {user._count.workspaces} workspace
            {user._count.workspaces !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Change Role */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Role</label>
          <div className="flex items-center gap-2">
            <select
              className={selectClass}
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              disabled={isSelf || isDeleted}
            >
              {ROLES.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleSaveRole}
              disabled={
                isSavingRole || isSelf || isDeleted || role === user.role
              }
            >
              {isSavingRole && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Save
            </Button>
          </div>
          {isSelf && (
            <p className="text-xs text-muted-foreground">
              Cannot change your own role.
            </p>
          )}
        </div>

        {/* Change Plan */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Plan</label>
          {currentPlanName && (
            <p className="text-xs text-muted-foreground">
              Current:{' '}
              <span className="font-medium text-foreground">
                {currentPlanName}
              </span>
            </p>
          )}
          <div className="flex items-center gap-2">
            <select
              className={selectClass}
              value={planId}
              onChange={e => setPlanId(e.target.value)}
              disabled={isDeleted || plans.length === 0}
            >
              {plans.length === 0 && <option value="">Loading plans…</option>}
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.price !== null ? ` — $${p.price}/mo` : ' — Custom'}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleSavePlan}
              disabled={
                isSavingPlan ||
                isDeleted ||
                !planId ||
                planId === (user.subscriptions?.[0]?.plan?.id ?? '')
              }
            >
              {isSavingPlan && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {/* Danger zone */}
          <div className="flex gap-2">
            {/* Block / Unblock */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBlocking || isSelf || isDeleted}
                >
                  {isBlocking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isBlocked ? (
                    <Shield className="h-4 w-4 mr-1.5" />
                  ) : (
                    <ShieldOff className="h-4 w-4 mr-1.5" />
                  )}
                  {isBlocked ? 'Unblock' : 'Block'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isBlocked ? 'Unblock' : 'Block'} user?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {isBlocked
                      ? `"${fullName}" will regain access to the platform.`
                      : `"${fullName}" will be prevented from logging in.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleToggleBlock}>
                    {isBlocked ? 'Unblock' : 'Block'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting || isSelf || isDeleted}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-1.5" />
                  )}
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete user?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &quot;{fullName}&quot; will be soft-deleted. Their
                    workspaces and data are preserved but the account becomes
                    inaccessible. This can be reversed by a database
                    administrator.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
