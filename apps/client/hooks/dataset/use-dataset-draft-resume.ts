'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from 'jotai'
import { toast } from 'sonner'
import { useDataSources } from '@/hooks/use-data-sources'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  parseWizardSnapshot,
  planResume,
  restoreSourceConfigs,
} from '@/lib/dataset-wizard-snapshot'
import {
  DW_TOTAL_STEPS,
  dwCurrentStepAtom,
  dwDraftIdAtom,
  dwHighestUnlockedAtom,
  dwModeAtom,
  initDatasetWizardAtom,
} from '@/store/dataset-studio'
import {
  datasetResumeTargetAtom,
  datasetSnapshotDraftIdAtom,
} from '@/hooks/dataset/dataset-draft-resume-state'
import { writeWizardSnapshotValues } from '@/hooks/dataset/dataset-wizard-snapshot-atoms'

/**
 * DS-LAKE-037. Reopens an interrupted Create Dataset session from
 * `/data-studio/create?draftId=<id>` - the dataset-side twin of
 * `useModelDraftResume`.
 *
 * Order matters and mirrors that hook: reset FIRST (`initDatasetWizardAtom`
 * clears every `dw*` atom, so nothing from whatever was on screen survives
 * into the restored draft), THEN hydrate with the atoms' raw setters.
 *
 * Rows are not restored from storage. A snapshot is configuration only, so the
 * wizard parks on Step 2 and `useDatasetResumeRefetch` re-runs the same fetch
 * the button would, then jumps to the saved step (D08). The server-side
 * artifact ids are deliberately left null: the bronze warm builds a fresh
 * BRONZE under the same draft, which is always correct even when the old
 * artifact was reclaimed by the idle sweep.
 *
 * Only the draft's creator can resume it (D09): `GET /:id` is readable by any
 * workspace member but withholds the snapshot from everyone else, and this
 * hook refuses on `isCreator` as well, so a shared browser cannot turn user
 * A's `?draftId=` into a session for user B.
 */
export function useDatasetDraftResume(): { resuming: boolean } {
  const store = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlDraftId = searchParams.get('draftId')
  const { sources, loading } = useDataSources()
  const [resuming, setResuming] = useState(false)
  const startedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!urlDraftId || loading) return
    // Already live in this session (the sync hook just wrote it to the URL),
    // or an edit session that must never be treated as a create resume.
    if (
      store.get(dwDraftIdAtom) === urlDraftId ||
      store.get(datasetSnapshotDraftIdAtom) === urlDraftId
    ) {
      return
    }
    if (store.get(dwModeAtom) !== 'create') return
    if (startedFor.current === urlDraftId) return
    startedFor.current = urlDraftId

    const leave = (message: string) => {
      toast.error(message)
      router.replace('/data-studio')
    }

    const run = async () => {
      setResuming(true)
      try {
        const res = await datasetDraftService.get(urlDraftId)
        const draft = res.data
        if (
          !draft.isCreator ||
          draft.status === 'SAVED' ||
          draft.editingDatasetId
        ) {
          leave('This dataset draft is not available to resume.')
          return
        }
        const parsed = parseWizardSnapshot(
          draft.wizardState,
          draft.wizardStateVersion,
        )
        if (!parsed.ok) {
          leave(
            "This draft was saved by an older version and can't be restored. Start the dataset again.",
          )
          return
        }
        // Claims about server artifacts are dropped and a late step pulled
        // back (see `planResume`); what is restored is the user's configuration.
        const plan = planResume(parsed.values, DW_TOTAL_STEPS)
        const { values } = plan

        const resolved = values.sourceIds.flatMap(id => {
          const found = sources.find(s => s.id === id)
          return found ? [found] : []
        })
        if (resolved.length === 0) {
          leave('The data sources for this draft are no longer available.')
          return
        }

        store.set(initDatasetWizardAtom, {
          name: values.name,
          description: values.description,
          workspaceId: values.workspaceId,
          sources: resolved,
        })
        writeWizardSnapshotValues(
          store,
          {
            ...values,
            sourceFetchConfigs: restoreSourceConfigs(
              values.sourceFetchConfigs,
              resolved,
            ),
          },
          resolved,
        )
        // Same slot rule as the sync hook: only a PI session shares the
        // pipeline's `dwDraftIdAtom`; anything else must leave it null so the
        // existing "has a draft" branches see exactly what they always saw.
        store.set(
          resolved.some(s => s.type === 'aveva')
            ? dwDraftIdAtom
            : datasetSnapshotDraftIdAtom,
          draft.id,
        )

        const needsFetch = resolved.some(s => s.type !== 'csv')
        const parked = needsFetch && plan.step > 2
        if (parked) {
          // Steps 3-6 are gated on rows. Park on Step 2 with later steps
          // locked; the re-fetch hook releases them when the rows land.
          store.set(datasetResumeTargetAtom, {
            step: plan.step,
            highestUnlocked: plan.highestUnlocked,
          })
          store.set(dwCurrentStepAtom, 2)
          store.set(dwHighestUnlockedAtom, 2)
        } else if (!needsFetch) {
          // A CSV's bytes are never stored, so the file has to come back.
          store.set(dwCurrentStepAtom, 1)
          store.set(dwHighestUnlockedAtom, 1)
        } else {
          store.set(dwCurrentStepAtom, plan.step)
          store.set(dwHighestUnlockedAtom, plan.highestUnlocked)
        }

        if (values.csvFileName) {
          toast.warning(
            `Re-upload ${values.csvFileName} in Step 1 to continue - the file itself isn't stored.`,
          )
        } else if (plan.pulledBack) {
          toast.success(
            `Draft restored at Step ${plan.step} - re-check features, then re-run cleaning before saving.`,
          )
        } else if (parked) {
          toast.success('Draft restored - fetching your data again.')
        } else {
          toast.success('Draft restored.')
        }
      } catch {
        leave("Couldn't load that dataset draft.")
      } finally {
        setResuming(false)
      }
    }
    void run()
  }, [urlDraftId, loading, sources, store, router])

  // A resume target outliving the wizard would make the NEXT wizard fetch and
  // jump on its own. The shell unmounting is the one place that always runs.
  useEffect(
    () => () => {
      store.set(datasetResumeTargetAtom, null)
      store.set(datasetSnapshotDraftIdAtom, null)
    },
    [store],
  )

  return { resuming }
}
