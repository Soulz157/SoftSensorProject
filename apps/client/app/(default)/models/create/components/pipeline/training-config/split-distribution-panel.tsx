'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { Layers, SplitSquareHorizontal } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { CompareTagsPopover } from '@/app/(default)/data-studio/create/components/processing/compare-tags-popover'
import { TagBoxplotChart } from '@/app/(default)/data-studio/create/components/chart/tag-boxplot-chart'
import { MAX_COMPARE } from '@/hooks/dataset/use-compare-tags'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type {
  DraftBoxplotResult,
  DraftTagBoxplot,
} from '@/services/dataset-draft'
import type { DraftSplitStatsResult } from '@/services/dataset-version'
import { mpSplitStatsTagsAtom, type Algorithm } from '@/store/model-pipeline'

interface Props {
  datasetId: string | null
  hasArtifact: boolean
  allTags: string[]
  targetVariables: string[]
  algorithms: Algorithm[]
  /** MODEL-FLOW-016-T10. The COMMITTED value — `undefined` means CV is
   * off. Mirrors the fetch's own sourcing: this panel reads what will
   * actually run, fetched once per Apply, never per keystroke. */
  nSplits: number | undefined
  /**
   * MODEL-FLOW-016-T10. The fetch itself now lives in the PARENT
   * (`Phase3TrainingConfig`), not here — `CoreConfig`'s own `CvControl`
   * needs the identical `max_admissible_k` this panel needs, and each
   * calling `useArtifactSplitStats` independently doubled the request on
   * every mount (caught by this feature's own V07 test: "Apply gates the
   * split-stats fetch... once" started failing at 2 calls, not 1). Worse
   * than the duplicate request itself: `CoreConfig` was passed the DRAFT
   * `trainTestSplit` (live, pre-Apply), so its own call would have
   * refetched on every ratio-slider drag — exactly the per-keystroke
   * refetch MODEL-FLOW-014-T08's Apply boundary exists to prevent. One
   * fetch, in the parent, sourced from the COMMITTED config either way,
   * fixes both problems at once.
   */
  splitStats: DraftSplitStatsResult | null
  loading: boolean
  missing: string | null
  refusal: string | null
  error: string | null
}

const TRAIN_COLOR = 'var(--chart-1)'
const TEST_COLOR = 'var(--chart-4)'
const TRAIN_SUFFIX = ' · train'
const TEST_SUFFIX = ' · test'

function trainLabel(tag: string): string {
  return `${tag}${TRAIN_SUFFIX}`
}
function testLabel(tag: string): string {
  return `${tag}${TEST_SUFFIX}`
}

/**
 * Combines both sides into one `DraftBoxplotResult`-shaped object so
 * `TagBoxplotChart` (typed against a single result) renders both with no
 * translation layer — same technique `dataset-compare-modal.tsx::
 * mergeBoxplotSides` uses for train-vs-validation.
 *
 * DELIBERATE DIVERGENCE from that function: `mergeBoxplotSides` only flags
 * a tag insufficient when BOTH sides lack it, because that modal is asking
 * "is there anything to compare at all". This panel exists to show the
 * OPPOSITE case — a tag with data on ONE side and not the other — so each
 * side's insufficiency is reported on its own label (`TAG · train` /
 * `TAG · test`), never merged away. This is what makes V04 ("a tag
 * insufficient on one side only is labelled per side") true: a merge that
 * only flagged both-sides-missing would hide exactly the asymmetry this
 * panel exists to surface.
 *
 * No connector is drawn between a train box and its test box (an
 * acceptance criterion in its own right) because the two sides are
 * rendered as separate X categories here, not as two points on one series
 * — `TagBoxplotChart` has no line-drawing concept between bars at all, so
 * this is true by construction, not by a flag this function sets.
 */
function mergeSplitSides(
  train: Omit<DraftBoxplotResult, 'source_key'> | null,
  test: Omit<DraftBoxplotResult, 'source_key'> | null,
  tags: string[],
): { result: DraftBoxplotResult; styleMap: Map<string, { color: string }> } {
  const trainByTag = new Map((train?.tags ?? []).map(t => [t.tag, t]))
  const testByTag = new Map((test?.tags ?? []).map(t => [t.tag, t]))
  const mergedTags: DraftTagBoxplot[] = []
  const styleMap = new Map<string, { color: string }>()
  const insufficientTags: string[] = []

  tags.forEach(tag => {
    const t = trainByTag.get(tag)
    if (t) {
      const label = trainLabel(tag)
      mergedTags.push({ ...t, tag: label })
      styleMap.set(label, { color: TRAIN_COLOR })
    } else {
      insufficientTags.push(trainLabel(tag))
    }

    const s = testByTag.get(tag)
    if (s) {
      const label = testLabel(tag)
      mergedTags.push({ ...s, tag: label })
      styleMap.set(label, { color: TEST_COLOR })
    } else {
      insufficientTags.push(testLabel(tag))
    }
  })

  return {
    result: {
      source_key: '',
      tags: mergedTags,
      insufficient_tags: insufficientTags,
    },
    styleMap,
  }
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border p-6 text-center ring-1 ring-foreground/5">
      <SplitSquareHorizontal className="h-6 w-6 text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  )
}

function fmtRows(n: number): string {
  return n.toLocaleString()
}

/**
 * MODEL-FLOW-014-T05. Per-tag box plots comparing the train side against the
 * test side of the chronological split the run will REALLY make at the
 * current ratio — before the user pays for a container fit to find out the
 * two sides look nothing alike. Reads only: a committed artifact and the
 * ratio Core Config already holds. Creates no Model row, no ModelDraft
 * column (finding 6 in this feature's own ledger entry) — this panel has no
 * server state of its own.
 */
export function SplitDistributionPanel({
  datasetId,
  hasArtifact,
  allTags,
  targetVariables,
  algorithms,
  nSplits,
  splitStats,
  loading,
  missing,
  refusal,
  error,
}: Props) {
  const targetY = targetVariables.length === 1 ? targetVariables[0]! : null

  // MODEL-FLOW-014-T06. An atom, not local state: `use-model-training.ts`
  // reads this same selection at launch so the frozen `splitStats` sidecar
  // matches what the panel actually displayed, not an approximation.
  const [selectedTags, setSelectedTags] = useAtom(mpSplitStatsTagsAtom)
  const prevTargetRef = useRef<string | null>(null)

  // Default to the target alone, and re-seed ONLY when the target itself
  // changes — not on every allTags/algorithm/ratio change, which would
  // stomp a selection the user already built.
  useEffect(() => {
    if (targetY !== prevTargetRef.current) {
      prevTargetRef.current = targetY
      setSelectedTags(targetY ? [targetY] : [])
    }
  }, [targetY, setSelectedTags])

  const toggle = useCallback(
    (tag: string) => {
      setSelectedTags(prev => {
        if (prev.includes(tag)) return prev.filter(t => t !== tag)
        if (prev.length >= MAX_COMPARE) return prev
        return [...prev, tag]
      })
    },
    [setSelectedTags],
  )
  const atCap = selectedTags.length >= MAX_COMPARE

  const colorForTag = useCallback(
    (tag: string) => chartColorVar(resolveTagMeta(tag).chartIndex),
    [],
  )

  // lstm/gru cut on WINDOW count via a different rule (train.py::
  // chronological_split_windows) this endpoint does not implement — the
  // panel declines to describe a split it did not compute, rather than
  // showing a tabular cut as if it were theirs.
  const hasSequenceAlgorithm = algorithms.some(a => a === 'lstm' || a === 'gru')

  // MODEL-FLOW-016-T10. CV is TABULAR ONLY (T01(c), same gate
  // `hasSequenceAlgorithm` already applies above) — `nSplits` can only be
  // non-undefined for a non-sequence algorithm by construction (CoreConfig's
  // own CvControl disables the toggle for lstm/gru), so no extra guard is
  // needed here beyond what the parent's own fetch already establishes.
  const cvMode = nSplits !== undefined

  if (!datasetId) {
    return <EmptyPanel>No dataset selected — go back to Step 1.</EmptyPanel>
  }

  if (!hasArtifact) {
    return (
      <EmptyPanel>
        This dataset has no stored artifact yet — the train/test split cannot be
        shown until its rows are committed.
      </EmptyPanel>
    )
  }

  if (targetVariables.length === 0) {
    return (
      <EmptyPanel>
        Select a target variable above to see its train/test split.
      </EmptyPanel>
    )
  }

  if (targetVariables.length > 1) {
    return (
      <EmptyPanel>
        Select a single target variable to see its train/test split — a split
        needs exactly one target.
      </EmptyPanel>
    )
  }

  if (hasSequenceAlgorithm) {
    return (
      <EmptyPanel>
        LSTM/GRU cut the split by window, not by row — this panel shows the
        tabular split every other algorithm uses, so it does not describe the
        split these will actually get.
      </EmptyPanel>
    )
  }

  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-56 w-full" />
      </div>
    )
  }

  if (missing) {
    return <EmptyPanel>{missing}</EmptyPanel>
  }

  if (refusal) {
    return <EmptyPanel>{refusal}</EmptyPanel>
  }

  if (error) {
    return <EmptyPanel>Could not load the split — {error}</EmptyPanel>
  }

  if (cvMode) {
    return <CvFoldPlan splitStats={splitStats} />
  }

  const merged = mergeSplitSides(
    splitStats?.train ?? null,
    splitStats?.test ?? null,
    selectedTags,
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          {splitStats &&
          splitStats.cut_timestamp !== null &&
          splitStats.train_labelled_rows !== null &&
          splitStats.test_labelled_rows !== null ? (
            <span>
              Cut at{' '}
              <span className="font-medium text-foreground">
                {new Date(splitStats.cut_timestamp).toLocaleString()}
              </span>{' '}
              — {fmtRows(splitStats.train_labelled_rows)} train /{' '}
              {fmtRows(splitStats.test_labelled_rows)} test labelled rows
            </span>
          ) : (
            // Ratio mode, not yet loaded — CV mode returns via CvFoldPlan
            // above before this branch is ever reached (cvMode is checked
            // first), so this null case is exclusively "move the slider".
            <span>Move the split slider to preview the cut.</span>
          )}
        </div>
        <CompareTagsPopover
          activeTags={allTags}
          compareTags={selectedTags}
          toggle={toggle}
          atCap={atCap}
          colorForTag={colorForTag}
        />
      </div>

      <TagBoxplotChart
        data={splitStats ? merged.result : null}
        tags={merged.result.tags.map(t => t.tag)}
        status={
          selectedTags.length === 0
            ? 'no-tags'
            : splitStats
              ? 'ready'
              : 'pending'
        }
        seriesStyle={tag => merged.styleMap.get(tag) ?? { color: TRAIN_COLOR }}
      />
    </div>
  )
}

/**
 * MODEL-FLOW-016-T10. The fold plan CV will actually run, shown BEFORE the
 * user pays for it — same purpose the ratio-mode boxplot above serves,
 * different shape: no box statistics per this feature's own userDecisions
 * ("k FOLDS LIVE IN ONE RUN... folds are SAMPLES to aggregate", not
 * per-tag distributions to compare side by side). Row counts are shown
 * beside every fold on purpose (this feature's own acceptance criterion:
 * "so an expanding-window artefact cannot be misread as a period
 * finding") — an expanding window means later folds train on
 * increasingly more data, which reads as a trend unless the counts are
 * right there to explain it.
 */
function CvFoldPlan({
  splitStats,
}: {
  splitStats: DraftSplitStatsResult | null
}) {
  if (!splitStats || splitStats.folds === null) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const { folds, n_splits, source_rows, distinct_labelled_values } = splitStats

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Layers className="h-3.5 w-3.5" />
        <span>
          {n_splits} expanding fold{n_splits === 1 ? '' : 's'} over{' '}
          {fmtRows(source_rows)} rows ({distinct_labelled_values} distinct
          labelled values)
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fold</th>
              <th className="px-3 py-2 font-medium">Cut</th>
              <th className="px-3 py-2 font-medium text-right">Train rows</th>
              <th className="px-3 py-2 font-medium text-right">Test rows</th>
              <th className="px-3 py-2 font-medium text-right">
                Distinct (test)
              </th>
            </tr>
          </thead>
          <tbody>
            {folds.map((fold, i) => (
              <tr
                key={i}
                className={i > 0 ? 'border-t border-border' : undefined}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {i + 1}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(fold.cut_timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fmtRows(fold.train_rows)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fmtRows(fold.test_rows)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.distinct}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Expanding window — each fold trains on everything before its own test
        window, so later folds train on more rows. A fold with far fewer
        distinct values than its neighbours is a real finding, not noise — check
        what changed around its cut.
      </p>
    </div>
  )
}
