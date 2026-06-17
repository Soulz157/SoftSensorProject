'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity,
  ArrowRightLeft,
  BrainCircuit,
  Loader2,
  Palette,
  Save,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { workspaceService } from '@/services/workspace'
import { workspaceColors, workspaceIcons } from '@/store/workspace'
import { useAdminWorkspaceSettings } from '@/hooks/admin/use-admin-workspace-settings'
import type { AdminWorkspace, WorkspaceMember, WorkspaceRole } from '@/types'
import { AdminPlanCard } from './components/admin-plan-card'

function roleBadgeVariant(
  role: WorkspaceRole,
): 'default' | 'secondary' | 'outline' {
  if (role === 'OWNER') return 'default'
  if (role === 'STAFF') return 'secondary'
  return 'outline'
}

export default function WorkspaceSettingsPage() {
  const { id: workspaceId } = useParams<{ id: string }>()

  const {
    workspace,
    members,
    setMembers,
    loading,
    name,
    setName,
    description,
    setDescription,
    selectedIcon,
    setSelectedIcon,
    selectedColor,
    setSelectedColor,
  } = useAdminWorkspaceSettings(workspaceId)

  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('VIEWER')
  const [isInviting, setIsInviting] = useState(false)
  const [movingMember, setMovingMember] = useState<WorkspaceMember | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [isMoving, setIsMoving] = useState(false)
  const [otherWorkspaces, setOtherWorkspaces] = useState<AdminWorkspace[]>([])

  useEffect(() => {
    let active = true
    workspaceService
      .getAdminWorkspaces({ limit: 100 })
      .then(res => {
        if (active) setOtherWorkspaces(res.data.items)
      })
      .catch(() => {
        if (active) setOtherWorkspaces([])
      })
    return () => {
      active = false
    }
  }, [])

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Workspace name is required')
      return
    }
    setIsSaving(true)
    try {
      await workspaceService.updateWorkspace(workspaceId, {
        name,
        icon: selectedIcon,
        color: selectedColor,
        description: description || null,
      })
      toast.success('Workspace updated')
    } catch {
      toast.error('Failed to update workspace')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      await workspaceService.adminRemoveMember(workspaceId, memberId)
      setMembers(prev => prev.filter(m => m.id !== memberId))
      toast.success('Member removed')
    } catch {
      toast.error('Failed to remove member')
    }
  }

  async function handleRoleChange(memberId: string, role: WorkspaceRole) {
    try {
      const res = await workspaceService.adminUpdateMemberRole(
        workspaceId,
        memberId,
        role,
      )
      setMembers(prev => prev.map(m => (m.id === memberId ? res.data : m)))
    } catch (error) {
      console.error(error)
      toast.error('Failed to update role')
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) {
      toast.error('Email is required')
      return
    }
    setIsInviting(true)
    try {
      const res = await workspaceService.adminInviteMember(
        workspaceId,
        inviteEmail,
        inviteRole,
      )
      setMembers(prev => [...prev, res.data])
      setInviteEmail('')
      setInviteOpen(false)
      toast.success('Member invited')
    } catch {
      toast.error('Failed to invite member')
    } finally {
      setIsInviting(false)
    }
  }

  async function handleMoveMember() {
    if (!movingMember || !moveTarget) return
    setIsMoving(true)
    try {
      await workspaceService.adminMoveMember(
        workspaceId,
        movingMember.id,
        moveTarget,
      )
      setMembers(prev => prev.filter(m => m.id !== movingMember.id))
      toast.success('Member moved')
      setMovingMember(null)
      setMoveTarget('')
    } catch (error) {
      console.error(error)
      toast.error('Failed to move member')
    } finally {
      setIsMoving(false)
    }
  }

  const moveOptions = otherWorkspaces.filter(w => w.id !== workspaceId)
  const ownerCount = members.filter(m => m.role === 'OWNER').length
  const owner = members.find(m => m.role === 'OWNER')

  const filteredMembers = members.filter(m => {
    const q = searchQuery.toLowerCase()
    const fullName = [m.user.firstName, m.user.lastName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return fullName.includes(q) || m.user.email.toLowerCase().includes(q)
  })

  return (
    <div className="flex-1 overflow-auto bg-muted/20 p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Link
                href="/admin/workspaces"
                className="transition-colors hover:text-primary"
              >
                Workspaces
              </Link>
              <span>/</span>
              {loading ? (
                <Skeleton className="h-4 w-28" />
              ) : (
                <span className="font-medium text-foreground">
                  {workspace?.name}
                </span>
              )}
              <span>/</span>
              <span className="font-medium text-foreground">Settings</span>
            </div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground">
              <Settings className="h-7 w-7 text-primary" />
              Workspace Settings
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/workspaces">
              <Button variant="outline">Back</Button>
            </Link>
            <Button
              className="gap-2"
              onClick={handleSave}
              disabled={isSaving || loading}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Left: General + Stats */}
          <div className="space-y-6 xl:col-span-1">
            <AdminPlanCard ownerUserId={owner?.userId} />
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">General Settings</CardTitle>
                <CardDescription>
                  Update workspace name, icon, and color.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1.5">
                  <Label>Workspace Name</Label>
                  {loading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Input
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Description</Label>
                  {loading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : (
                    <Textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Optional workspace description…"
                      rows={3}
                      className="min-h-20 resize-none"
                    />
                  )}
                </div>

                <div className="space-y-3 pt-1">
                  <Label>Icon</Label>
                  {loading ? (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-9 rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {workspaceIcons.map(item => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            title={item.label}
                            onClick={() => setSelectedIcon(item.id)}
                            className={`rounded-lg border p-2 transition-all ${
                              selectedIcon === item.id
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-background text-muted-foreground hover:bg-accent'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-1">
                  <Label className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Color
                  </Label>
                  {loading ? (
                    <div className="flex gap-3">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-7 w-7 rounded-full" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      {workspaceColors.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedColor(c.id)}
                          className={`h-7 w-7 rounded-full transition-all ring-offset-background ${c.bg} ${
                            selectedColor === c.id
                              ? 'ring-2 ring-ring ring-offset-2'
                              : 'opacity-70 hover:scale-110 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    Members
                  </div>
                  {loading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <span className="text-2xl font-bold text-foreground">
                      {workspace?._count.members ?? 0}
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <BrainCircuit className="h-3.5 w-3.5" />
                    Models
                  </div>
                  {loading ? (
                    <Skeleton className="h-7 w-10" />
                  ) : (
                    <span className="text-2xl font-bold text-foreground">
                      {workspace?._count.models ?? 0}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Members */}
          <div className="xl:col-span-2">
            <Card className="flex h-full flex-col">
              <CardHeader className="flex flex-row items-start justify-between pb-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    Members
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    Manage workspace access and roles.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  Invite
                </Button>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search members…"
                    className="pl-9"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="overflow-hidden rounded-md border border-border">
                  {loading ? (
                    <div className="divide-y divide-border">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 p-4">
                          <Skeleton className="h-10 w-10 rounded-full" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredMembers.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {searchQuery
                        ? `No members matching "${searchQuery}"`
                        : 'No members yet.'}
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {filteredMembers.map(member => {
                        const fullName =
                          [member.user.firstName, member.user.lastName]
                            .filter(Boolean)
                            .join(' ') || '—'
                        const initials =
                          [member.user.firstName, member.user.lastName]
                            .filter(Boolean)
                            .map(n => n![0])
                            .join('')
                            .toUpperCase() || '?'

                        return (
                          <div
                            key={member.id}
                            className="flex items-center justify-between p-4 transition-colors hover:bg-muted/30"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar size="lg">
                                <AvatarFallback
                                  className={
                                    member.role === 'OWNER'
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-slate-500 text-white'
                                  }
                                >
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {fullName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {member.user.email}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Badge variant={roleBadgeVariant(member.role)}>
                                {member.role.charAt(0) +
                                  member.role.slice(1).toLowerCase()}
                              </Badge>

                              <Select
                                value={member.role}
                                onValueChange={val =>
                                  handleRoleChange(
                                    member.id,
                                    val as WorkspaceRole,
                                  )
                                }
                              >
                                <SelectTrigger className="h-8 w-[100px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="OWNER">Owner</SelectItem>
                                  <SelectItem value="STAFF">Staff</SelectItem>
                                  <SelectItem value="VIEWER">Viewer</SelectItem>
                                </SelectContent>
                              </Select>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                title={
                                  member.role === 'OWNER' && ownerCount <= 1
                                    ? 'Cannot move the last owner'
                                    : 'Move to another workspace'
                                }
                                disabled={
                                  member.role === 'OWNER' && ownerCount <= 1
                                }
                                onClick={() => {
                                  setMovingMember(member)
                                  setMoveTarget('')
                                }}
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>

                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    title="Remove member"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Remove member?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Remove{' '}
                                      <span className="font-semibold text-foreground">
                                        {fullName}
                                      </span>{' '}
                                      from this workspace? They will lose access
                                      immediately.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() =>
                                        handleRemoveMember(member.id)
                                      }
                                    >
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
            <DialogDescription>
              Add a user to this workspace by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={val => setInviteRole(val as WorkspaceRole)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                  <SelectItem value="STAFF">Staff</SelectItem>
                  <SelectItem value="OWNER">Owner</SelectItem>
                </SelectContent>
              </Select>
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
            <Button onClick={handleInvite} disabled={isInviting}>
              {isInviting && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Member Dialog */}
      <Dialog
        open={!!movingMember}
        onOpenChange={open => {
          if (!open) {
            setMovingMember(null)
            setMoveTarget('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move Member</DialogTitle>
            <DialogDescription>
              Move{' '}
              <span className="font-semibold text-foreground">
                {movingMember
                  ? [movingMember.user.firstName, movingMember.user.lastName]
                      .filter(Boolean)
                      .join(' ') || movingMember.user.email
                  : ''}
              </span>{' '}
              to another workspace. Their role is kept and they lose access to
              this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Target workspace</Label>
              <Select value={moveTarget} onValueChange={setMoveTarget}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {moveOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No other workspaces
                    </div>
                  ) : (
                    moveOptions.map(w => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMovingMember(null)
                setMoveTarget('')
              }}
              disabled={isMoving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMoveMember}
              disabled={isMoving || !moveTarget}
            >
              {isMoving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
