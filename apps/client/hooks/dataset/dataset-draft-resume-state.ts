import { atom } from 'jotai'

/**
 * DS-LAKE-037. Where a resumed wizard should land once its rows are back.
 *
 * Resume restores the configuration immediately but the rows only after the
 * Step 2 fetch re-runs, and Steps 3-6 are gated on those rows. So the wizard
 * sits on Step 2 meanwhile and this remembers the real destination. It is set
 * by `useDatasetDraftResume`, consumed by `useDatasetResumeRefetch` when the
 * fetch settles, and read by `useDatasetDraftSync` so the waiting period never
 * overwrites the saved step with 2.
 *
 * Declared here, not in `store/dataset-studio.ts`: that file is shared with
 * every wizard flow and this state belongs to resume alone.
 */
export interface DatasetResumeTarget {
  step: number
  highestUnlocked: number
}

export const datasetResumeTargetAtom = atom<DatasetResumeTarget | null>(null)

/**
 * DS-LAKE-037. The id of the snapshot draft for a session whose draft the
 * existing pipeline never creates - anything without a PI (aveva) source, i.e.
 * a CSV dataset. `dwDraftIdAtom` is deliberately NOT set for those: ~15 hooks
 * treat "has a draft id" as "uses the draft-first server pipeline" (Step 6's
 * save path, the gold warm, validation), and a CSV dataset must keep taking
 * the legacy path it always took. This atom is cleared when the wizard shell
 * unmounts, so one session's draft cannot leak into the next.
 */
export const datasetSnapshotDraftIdAtom = atom<string | null>(null)
