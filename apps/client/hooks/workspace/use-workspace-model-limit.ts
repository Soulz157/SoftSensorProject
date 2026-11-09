'use client'

import { limitReachedNote } from '@/lib/workspace-limits'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'

/**
 * MODEL-SERVE-041. Why one more model cannot be added to `workspaceId`
 * (its effective cap — admin override, else the owner's plan — is reached),
 * or null. `enabled` is false for editing a saved model, which adds nothing.
 *
 * Null while loading, with no workspace, or when the answer belongs to a
 * previously selected workspace, so it never blocks on missing data; the
 * backend still refuses the real overrun at Save Model.
 */
export function useWorkspaceModelLimit(
  workspaceId: string,
  enabled = true,
): string | null {
  const { workspace } = useWorkspace(enabled ? workspaceId : '')
  if (!enabled || !workspaceId) return null
  if (!workspace || workspace.id !== workspaceId) return null
  const models = workspace.quota?.models
  if (!models) return null
  return limitReachedNote('models', models.limit, models.current, models.source)
}
