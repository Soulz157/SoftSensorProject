'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  WIZARD_SNAPSHOT_VERSION,
  buildWizardSnapshot,
} from '@/lib/dataset-wizard-snapshot'
import {
  dwCurrentStepAtom,
  dwDraftIdAtom,
  dwFromRetrainAtom,
  dwModeAtom,
  dwNameAtom,
  dwSelectedSourcesAtom,
  dwWorkspaceIdAtom,
} from '@/store/dataset-studio'
import { ensureWizardDraftId } from '@/hooks/dataset/dataset-draft-bronze'
import {
  datasetResumeTargetAtom,
  datasetSnapshotDraftIdAtom,
} from '@/hooks/dataset/dataset-draft-resume-state'
import {
  SNAPSHOT_ATOMS,
  readWizardSnapshotValues,
} from '@/hooks/dataset/dataset-wizard-snapshot-atoms'

const PATCH_DEBOUNCE_MS = 600

/**
 * DS-LAKE-037. Keeps `DatasetDraft.wizardState` current so an interrupted
 * Create Dataset session (session expiry, closed tab, another device) can be
 * resumed - the dataset-side twin of `useModelDraftSync`.
 *
 * - CREATE mode only. Edit mode already has its own draft/hydration and a
 *   retrain hand-off seeds the wizard from a base recipe; neither is resumed
 *   by this feature (D04c), and writing `?draftId=` there would walk an
 *   edit-mode reload into the create-resume path (D06).
 * - The draft is created when the user LEAVES Step 1, not at mount: a wizard
 *   opened and abandoned on Step 1 leaves nothing behind.
 * - Subscribes to the snapshot atoms through the store rather than reading 40
 *   of them with `useAtomValue`, which would re-render the whole shell on
 *   every keystroke in the tag table.
 * - Writes are serialised, so a slow earlier PATCH can never land after a
 *   later one and roll the snapshot back.
 * - A failed write shows no banner (the next edit retries): this is a
 *   convenience, not a user action. It is logged with console.warn.
 */
export function useDatasetDraftSync(): void {
  const store = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlDraftId = searchParams.get('draftId')

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const urlDraftIdRef = useRef(urlDraftId)
  useEffect(() => {
    urlDraftIdRef.current = urlDraftId
  }, [urlDraftId])

  useEffect(() => {
    const syncOnce = async (): Promise<void> => {
      if (store.get(dwModeAtom) !== 'create') return
      if (store.get(dwFromRetrainAtom)) return

      const existingId =
        store.get(dwDraftIdAtom) ?? store.get(datasetSnapshotDraftIdAtom)
      const step = store.get(dwCurrentStepAtom)
      const resumeTarget = store.get(datasetResumeTargetAtom)
      // Leaving Step 1 is what creates the draft. A resume in flight counts as
      // already past it - it parks the wizard on Step 2 until rows are back.
      if (!existingId && step < 2 && !resumeTarget) return

      const workspaceId = store.get(dwWorkspaceIdAtom)
      const selectedSources = store.get(dwSelectedSourcesAtom)
      if (!workspaceId || selectedSources.length === 0) return

      const id = await ensureWizardDraftId(
        { workspaceId, selectedSources, name: store.get(dwNameAtom) },
        existingId,
      )
      // A PI session shares the row the bronze pipeline would have created
      // anyway (same source, same dedup), so it takes the pipeline's slot. A
      // session with no PI source (a CSV) must NOT get `dwDraftIdAtom`: that
      // would flip every "has a draft" branch downstream for a dataset that
      // never used the draft-first path.
      const slot = selectedSources.some(s => s.type === 'aveva')
        ? dwDraftIdAtom
        : datasetSnapshotDraftIdAtom
      if (id !== store.get(slot)) store.set(slot, id)

      const values = readWizardSnapshotValues(store)
      // While a resume is waiting for its re-fetch the wizard is parked on
      // Step 2; saving THAT would overwrite where the user really was.
      const target = store.get(datasetResumeTargetAtom)
      if (target) {
        values.currentStep = target.step
        values.highestUnlocked = target.highestUnlocked
      }
      await datasetDraftService.patch(id, {
        name: values.name || undefined,
        wizardState: buildWizardSnapshot(values),
        wizardStateVersion: WIZARD_SNAPSHOT_VERSION,
      })

      if (urlDraftIdRef.current !== id) {
        const next = new URLSearchParams(window.location.search)
        next.set('draftId', id)
        router.replace(`/data-studio/create?${next.toString()}`)
      }
    }

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        chainRef.current = chainRef.current.then(syncOnce).catch(err => {
          // Silent to the user (a convenience, not an action) but not to the
          // console: a 403, the size cap or a non-UUID source id would
          // otherwise leave resume quietly never working.
          console.warn('[dataset-draft-sync] snapshot not saved:', err)
        })
      }, PATCH_DEBOUNCE_MS)
    }

    const unsubscribers = [...SNAPSHOT_ATOMS, datasetResumeTargetAtom].map(
      atom => store.sub(atom, schedule),
    )
    schedule()

    return () => {
      unsubscribers.forEach(unsub => unsub())
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [store, router])
}
