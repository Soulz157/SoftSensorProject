import type {
  BronzeWarmState,
  PreviewSampleFetchState,
} from '@/store/dataset-studio'

/**
 * DS-LAKE-015-T03 (rev): picks the ONE phase Step 3.1 renders for the window
 * between Step 2's fetch finishing and this step's charts having real data,
 * out of `useDatasetBronzeWarm`'s and `useDatasetFeaturePreviewSample`'s
 * states. Pure so it is unit-testable without rendering `DataAnalysisCard`'s
 * atom-heavy tree (see `data-analysis-card-bounded.test.tsx`'s own note on
 * why that tree is avoided in tests).
 *
 * `preparing`/`loading`/`error`/`empty` carry the same indeterminate captions
 * as before — never a percentage (this feature's own findings: `materialize`
 * has no `PreprocessingJob` row to report one from).
 *
 * `bronzeWarmState === 'failed'` is deliberately UNCHECKED (AC4): a
 * background warm failing resolves to `ready` (no caption, real card), same
 * as before this feature — the user-visible retry is still the lazy
 * `ensureBronze` on the real first Apply in Step 3.2, not this banner.
 *
 * A CSV-only wizard (`fetchRequired: false`) never calls `useDatasetBronzeWarm`
 * at all, so `bronzeWarmState` sits at `'idle'` forever for that path — and
 * `useDatasetFeaturePreviewSample` no-ops on the null artifact id that
 * results, so `previewFetchState` ALSO sits at `'idle'` forever. `'idle'`
 * therefore MUST resolve to `ready`, not `loading`: mapping it to `loading`
 * would show an infinite skeleton and (with Step 3.1 gating Next on the busy
 * phases) permanently block CSV-only wizards, since nothing else ever moves
 * `previewFetchState` off `'idle'` for that path.
 */
export type AnalysisReadiness =
  | { phase: 'preparing'; caption: string }
  | { phase: 'loading'; caption: string }
  | { phase: 'error'; caption: string }
  | { phase: 'empty'; caption: string }
  | { phase: 'ready' }

export function describeAnalysisReadiness(args: {
  fetchRequired: boolean
  bronzeWarmState: BronzeWarmState
  previewFetchState: PreviewSampleFetchState
  sampleTagCount: number
}): AnalysisReadiness {
  const { fetchRequired, bronzeWarmState, previewFetchState, sampleTagCount } =
    args

  if (fetchRequired && bronzeWarmState === 'materializing') {
    return {
      phase: 'preparing',
      caption:
        'Preparing the artifact for analysis — charts below will populate once it’s ready.',
    }
  }
  if (previewFetchState === 'loading') {
    return { phase: 'loading', caption: 'Loading the preview sample…' }
  }
  if (previewFetchState === 'error') {
    return {
      phase: 'error',
      caption:
        'Could not load the preview sample. The charts below may stay empty until you revisit Step 3.2.',
    }
  }
  if (previewFetchState === 'ready' && sampleTagCount === 0) {
    return {
      phase: 'empty',
      caption:
        'Preview sample loaded — no columns to chart yet for this artifact.',
    }
  }
  return { phase: 'ready' }
}
