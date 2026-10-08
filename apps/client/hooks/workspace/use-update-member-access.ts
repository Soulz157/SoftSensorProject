'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import { toPermissionPayload } from '@/lib/workspace-access'
import type {
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from '@/types'

/** Saves a member's role and VIEWER feature grants in one PATCH. */
export function useUpdateMemberAccess(workspaceId: string) {
  const [isSaving, setIsSaving] = useState(false)

  const updateMemberAccess = async (
    member: WorkspaceMember,
    role: WorkspaceRole,
    permissions: readonly WorkspacePermission[],
  ): Promise<boolean> => {
    setIsSaving(true)
    try {
      await workspaceService.updateMemberRole(
        workspaceId,
        member.id,
        role,
        toPermissionPayload(role, permissions),
      )
      toast.success('Member access updated')
      return true
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update member access',
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return { updateMemberAccess, isSaving }
}
