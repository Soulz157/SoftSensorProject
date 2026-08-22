'use client'

import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { workspacesAtom } from '@/store/workspace'
import { mpServerDraftIdAtom } from '@/store/model-pipeline'
import { useModelDrafts } from '@/hooks/model/use-model-drafts'
import { useModelDraftResume } from '@/hooks/model/use-model-draft-resume'
import { modelDraftService, type ModelDraft } from '@/services/model-draft'
import { DraftResumePanel } from './draft-resume-panel'

interface Props {
  workspaceId: string
  /**
   * True when the wizard already holds work that resuming would replace — a
   * typed name or a chosen dataset. Drives the confirm below.
   */
  dirty: boolean
}

/**
 * Unfinished drafts, offered at the top of Step 1 (MODEL-FLOW-010-T08).
 *
 * Lives inside the wizard rather than on the models list because that is where
 * the user is when they need it — and because Step 2's Edit Dataset dialog
 * points here by name.
 *
 * Resume hydrates IN PLACE. Pushing `?draftId=` from here would be inert: the
 * wizard is already mounted on `/models/create`, so `useModelWizardMode`'s
 * run-once effect would never see the changed query.
 *
 * Scoped to the chosen workspace once there is one, unscoped before that — at
 * Step 1 the draft you want may well be the reason you are picking that
 * workspace at all.
 */
export function DraftResumeSection({ workspaceId, dirty }: Props) {
  const workspaces = useAtomValue(workspacesAtom)
  const currentDraftId = useAtomValue(mpServerDraftIdAtom)
  const { resume, resuming } = useModelDraftResume()
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null)
  // ONE confirm serves all three removes — the row X, Remove selected and
  // Remove all differ only in which drafts they hand it. A second and third
  // dialog would be three copies of the same wording to keep in step.
  const [removeTargets, setRemoveTargets] = useState<ModelDraft[] | null>(null)
  const [removing, setRemoving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // ACTIVE only: a TRAINED draft is equally resumable and the API supports it,
  // but offering one before its run result can be rebuilt would promise more
  // than the wizard restores.
  const { drafts, loading, refetch } = useModelDrafts({
    workspaceId: workspaceId || undefined,
    status: 'ACTIVE',
  })

  // The draft already open is not a draft to go back to.
  const others = drafts.filter(d => d.id !== currentDraftId)

  function requestResume(draftId: string) {
    if (dirty) {
      setPendingDraftId(draftId)
      return
    }
    void resume(draftId)
  }

  async function confirmResume() {
    const draftId = pendingDraftId
    setPendingDraftId(null)
    if (draftId) await resume(draftId)
  }

  function toggleSelect(draftId: string) {
    setSelectedIds(prev =>
      prev.includes(draftId)
        ? prev.filter(id => id !== draftId)
        : [...prev, draftId],
    )
  }

  /**
   * Selection is by id, so it can outlive a refetch that no longer contains
   * those rows. Resolve against the CURRENT list rather than a remembered
   * snapshot, or a draft removed in another tab would be "removed" again.
   */
  const selectedDrafts = others.filter(d => selectedIds.includes(d.id))

  /**
   * ABANDON, not delete — the draft's training runs stay in Postgres and only
   * its status changes, the rule `abandonDraftService` states for itself. So
   * the honest word for the user is "removed from this list", not "deleted".
   *
   * There is no bulk endpoint and this does not invent one: it fans out one
   * abandon per draft and settles them all, because a bulk route that abandons
   * some rows and fails on others has the same partial outcome to report — it
   * would just hide it behind a single status code.
   */
  async function confirmRemove() {
    const targets = removeTargets
    if (!targets || targets.length === 0) return
    setRemoving(true)
    try {
      const results = await Promise.allSettled(
        targets.map(draft => modelDraftService.abandon(draft.id)),
      )
      const failed = results.filter(r => r.status === 'rejected').length

      if (failed === targets.length) {
        // Nothing moved. Kept open, because a dialog closing over rows that
        // all stayed put reads as the remove having worked.
        toast.error(
          targets.length === 1
            ? 'Could not remove that draft — try again.'
            : 'Could not remove those drafts — try again.',
        )
        return
      }

      // Some or all went through: close and re-read, then say plainly if the
      // list still holds drafts the user asked to be rid of.
      if (failed > 0) {
        toast.error(
          `${failed} of ${targets.length} drafts could not be removed.`,
        )
      }
      setRemoveTargets(null)
      setSelectedIds([])
      refetch()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <DraftResumePanel
        drafts={others}
        loading={loading || resuming}
        workspaceName={id =>
          workspaces.find(w => w.id === id)?.name ?? 'Unknown Workspace'
        }
        onResume={requestResume}
        onRemove={draft => setRemoveTargets([draft])}
        // The intersection, not the raw state: an id can drop out of the list
        // (its draft was resumed, or removed in another tab) and a count with
        // nothing behind it would offer "Remove selected (1)" that removes
        // nothing.
        selectedIds={selectedDrafts.map(d => d.id)}
        onToggleSelect={toggleSelect}
        onRemoveSelected={() => setRemoveTargets(selectedDrafts)}
        onRemoveAll={() => setRemoveTargets(others)}
      />

      {/* Only raised when there is something to lose. Resuming clears the
          wizard, and nothing on screen at Step 1 has been written anywhere
          yet, so this is the only warning the user gets. */}
      <AlertDialog
        open={pendingDraftId !== null}
        onOpenChange={open => {
          if (!open) setPendingDraftId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              What you have entered here — the name, the selected dataset and
              any training configuration — is replaced by the saved draft. None
              of it has been saved yet, so it cannot be brought back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmResume()}>
              Replace and resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmed rather than immediate, matching how ModelTable guards its
          own row-level destructive action: an X sits one mis-click from
          Resume, and there is no undo for it anywhere in the UI. */}
      <AlertDialog
        open={removeTargets !== null}
        onOpenChange={open => {
          if (!open && !removing) setRemoveTargets(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removeTargets && removeTargets.length === 1
                ? `Remove “${removeTargets[0]?.name?.trim() || 'Untitled draft'}”?`
                : `Remove ${removeTargets?.length ?? 0} drafts?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removeTargets && removeTargets.length === 1
                ? 'It is taken off this list and cannot be resumed. Any training runs it already produced are kept.'
                : 'They are taken off this list and cannot be resumed. Any training runs they already produced are kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={event => {
                // Hold the dialog open until the server confirms, so a failed
                // remove can say so instead of closing on a row that stayed.
                event.preventDefault()
                void confirmRemove()
              }}
            >
              {removing ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
