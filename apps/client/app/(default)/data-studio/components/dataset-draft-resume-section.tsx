'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { FileClock, X } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { DW_TOTAL_STEPS } from '@/store/dataset-studio'
import type { ResumableDatasetDraft } from '@/services/dataset-draft'
import { useResumableDatasetDrafts } from '@/hooks/dataset/use-resumable-dataset-drafts'

interface Props {
  getWorkspaceName: (id: string) => string
}

/**
 * DS-LAKE-037-T08. Unfinished Create Dataset drafts, offered above the dataset
 * list so a user whose session expired mid-wizard can find their work.
 *
 * Resume navigates to `/data-studio/create?draftId=`; the wizard's own resume
 * hook does the restoring (and refuses anyone but the creator). An ABANDONED
 * draft is one the idle sweep gave up on: its settings survive but its server
 * data may be gone, so the row says the data will be fetched again rather than
 * promising an exact return.
 *
 * Discard is confirmed, matching the Model Creation drafts it mirrors - it has
 * no undo.
 */
export function DatasetDraftResumeSection({ getWorkspaceName }: Props) {
  const router = useRouter()
  const { drafts, loading, discard } = useResumableDatasetDrafts()
  const [target, setTarget] = useState<ResumableDatasetDraft | null>(null)
  const [discarding, setDiscarding] = useState(false)

  if (loading || drafts.length === 0) return null

  async function confirmDiscard() {
    if (!target) return
    setDiscarding(true)
    try {
      await discard(target.id)
      setTarget(null)
    } catch {
      toast.error('Could not discard that draft - try again.')
    } finally {
      setDiscarding(false)
    }
  }

  return (
    <>
      <section
        aria-label="Unfinished datasets"
        className="space-y-1 rounded-xl bg-card p-3 ring-1 ring-border"
      >
        <div className="flex items-center gap-2 px-1 pb-1">
          <FileClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h2 className="text-xs font-medium text-foreground">
            Unfinished {drafts.length === 1 ? 'dataset' : 'datasets'}
          </h2>
        </div>
        <ul className="divide-y divide-border">
          {drafts.map(draft => (
            <li key={draft.id} className="flex items-center gap-3 py-2 pl-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">
                  {draft.name?.trim() || 'Untitled dataset'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {getWorkspaceName(draft.workspaceId)}
                  {draft.currentStep !== null &&
                    ` · Step ${draft.currentStep} of ${DW_TOTAL_STEPS}`}
                  {` · edited ${formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}`}
                  {draft.status === 'ABANDONED' &&
                    ' · data will be fetched again'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  router.push(
                    `/data-studio/create?draftId=${encodeURIComponent(draft.id)}`,
                  )
                }
              >
                Resume
              </Button>
              <button
                type="button"
                onClick={() => setTarget(draft)}
                aria-label={`Discard ${draft.name?.trim() || 'untitled dataset'}`}
                className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:w-8"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <AlertDialog
        open={target !== null}
        onOpenChange={open => {
          if (!open && !discarding) setTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Discard “{target?.name?.trim() || 'Untitled dataset'}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its settings are removed and it can no longer be resumed. Nothing
              has been saved as a dataset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discarding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={discarding}
              onClick={event => {
                event.preventDefault()
                void confirmDiscard()
              }}
            >
              {discarding ? 'Discarding…' : 'Discard'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
