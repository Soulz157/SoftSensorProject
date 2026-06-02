'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Activity,
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
import { useWorkspaceSettings } from '@/hooks/workspace/use-workspace-settings'
import type { WorkspaceRole } from '@/types'

const inputClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export default function WorkspaceSettingsPage() {
  const { id: workspaceId } = useParams<{ id: string }>()

  const {
    workspace,
    members,
    setMembers,
    loading,
    name,
    setName,
    selectedIcon,
    setSelectedIcon,
    selectedColor,
    setSelectedColor,
  } = useWorkspaceSettings(workspaceId)

  const [isSaving, setIsSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('VIEWER')
  const [isInviting, setIsInviting] = useState(false)

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
      await workspaceService.removeMember(workspaceId, memberId)
      setMembers(prev => prev.filter(m => m.id !== memberId))
      toast.success('Member removed')
    } catch {
      toast.error('Failed to remove member')
    }
  }

  async function handleRoleChange(memberId: string, role: WorkspaceRole) {
    try {
      const res = await workspaceService.updateMemberRole(
        workspaceId,
        memberId,
        role,
      )
      setMembers(prev => prev.map(m => (m.id === memberId ? res.data : m)))
    } catch {
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
      const res = await workspaceService.inviteMember(
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
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">General Settings</CardTitle>
                <CardDescription>
                  Update workspace name, icon, and color.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Workspace Name</label>
                  {loading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <input
                      type="text"
                      className={inputClass}
                      value={name}
                      onChange={e => setName(e.target.value)}
                    />
                  )}
                </div>

                <div className="space-y-3 pt-1">
                  <label className="text-sm font-medium">Icon</label>
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
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    Color
                  </label>
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
                  <input
                    type="text"
                    placeholder="Search members…"
                    className={`${inputClass} pl-9`}
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
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${
                                  member.role === 'OWNER'
                                    ? 'bg-primary'
                                    : 'bg-slate-500'
                                }`}
                              >
                                {initials}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  {fullName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {member.user.email}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <select
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:ring-1 focus:ring-ring"
                                value={member.role}
                                onChange={e =>
                                  handleRoleChange(
                                    member.id,
                                    e.target.value as WorkspaceRole,
                                  )
                                }
                              >
                                <option value="OWNER">Owner</option>
                                <option value="VIEWER">Viewer</option>
                              </select>

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
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                className={inputClass}
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role</label>
              <select
                className={inputClass}
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as WorkspaceRole)}
              >
                <option value="VIEWER">Viewer</option>
                <option value="OWNER">Owner</option>
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
            <Button onClick={handleInvite} disabled={isInviting}>
              {isInviting && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
