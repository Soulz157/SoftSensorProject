'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { UserPlus, MoreHorizontal, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { workspaceService } from '@/services/workspace'
import { useWorkspaceMembers } from '@/hooks/workspace/use-workspace-members'
import type { WorkspaceMember, WorkspaceRole } from '@/types'

interface WorkspaceMembersProps {
  workspaceId: string
}

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function roleBadge(role: WorkspaceRole) {
  return role === 'OWNER'
    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

function getInitials(
  firstName: string | null,
  lastName: string | null,
  email: string,
) {
  const f = firstName?.[0] ?? ''
  const l = lastName?.[0] ?? ''
  return (f + l).toUpperCase() || (email[0] ?? '?').toUpperCase()
}

function MembersSkeleton() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-1 h-3 w-32" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-7 w-7 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

export function WorkspaceMembers({ workspaceId }: WorkspaceMembersProps) {
  const { data: session } = useSession()
  const currentUserId = session?.user?.id

  const { members, loading, isFetching, isOwner, fetchMembers } =
    useWorkspaceMembers(workspaceId, currentUserId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('VIEWER')
  const [isInviting, setIsInviting] = useState(false)

  const [mutatingId, setMutatingId] = useState<string | null>(null)

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setIsInviting(true)
    try {
      await workspaceService.inviteMember(
        workspaceId,
        inviteEmail.trim(),
        inviteRole,
      )
      toast.success(`Invited ${inviteEmail}`)
      setInviteEmail('')
      setInviteRole('VIEWER')
      setInviteOpen(false)
      await fetchMembers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to invite member'
      toast.error(msg)
    } finally {
      setIsInviting(false)
    }
  }

  async function handleRoleChange(
    member: WorkspaceMember,
    role: WorkspaceRole,
  ) {
    setMutatingId(member.id)
    try {
      await workspaceService.updateMemberRole(workspaceId, member.id, role)
      toast.success(`Role updated to ${role}`)
      await fetchMembers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update role'
      toast.error(msg)
    } finally {
      setMutatingId(null)
    }
  }

  async function handleRemove(member: WorkspaceMember) {
    setMutatingId(member.id)
    try {
      await workspaceService.removeMember(workspaceId, member.id)
      toast.success('Member removed')
      await fetchMembers()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove member'
      toast.error(msg)
    } finally {
      setMutatingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Members</h3>
          {!loading && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground font-medium">
              {members.length}
            </span>
          )}
        </div>
        {isOwner && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody
            className={cn(
              'transition-opacity duration-200',
              isFetching && !loading && 'opacity-60',
            )}
          >
            {loading ? (
              <MembersSkeleton />
            ) : members.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  No members yet.
                </TableCell>
              </TableRow>
            ) : (
              members.map(member => {
                const fullName =
                  [member.user.firstName, member.user.lastName]
                    .filter(Boolean)
                    .join(' ') || member.user.email
                const isSelf = member.userId === currentUserId
                const isMutating = mutatingId === member.id

                return (
                  <TableRow key={member.id}>
                    {/* Member info */}
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {getInitials(
                            member.user.firstName,
                            member.user.lastName,
                            member.user.email,
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {fullName}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {member.user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role badge */}
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          roleBadge(member.role),
                        )}
                      >
                        {member.role}
                      </span>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      {isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              disabled={isMutating}
                            >
                              {isMutating ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.role !== 'OWNER' ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleRoleChange(member, 'OWNER')
                                }
                              >
                                Make OWNER
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleRoleChange(member, 'VIEWER')
                                }
                              >
                                Make VIEWER
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleRemove(member)}
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Enter the email address of an existing user to invite them to this
              workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                className={inputClass}
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                disabled={isInviting}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Role
              </label>
              <select
                className={selectClass}
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as WorkspaceRole)}
                disabled={isInviting}
              >
                <option value="VIEWER">VIEWER — Read-only access</option>
                <option value="OWNER">OWNER — Full access</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={isInviting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={isInviting || !inviteEmail.trim()}
            >
              {isInviting && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
