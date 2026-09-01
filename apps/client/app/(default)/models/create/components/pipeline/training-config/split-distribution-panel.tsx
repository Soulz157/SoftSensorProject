'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { Layers, SplitSquareHorizontal } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { CompareTagsPopover } from '@/app/(default)/data-studio/create/components/processing/compare-tags-popover'
import { TagBoxplotChart } from '@/app/(default)/data-studio/create/components/chart/tag-boxplot-chart'
import { MAX_COMPARE } from '@/hooks/dataset/use-compare-tags'
import { useArtifactSplitStats } from '@/hooks/dataset/artifact/use-artifact-split-stats'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type {
  DraftBoxplotResult,
  DraftTagBoxplot,
} from '@/services/dataset-draft'
import { mpSplitStatsTagsAtom, type Algorithm } from '@/store/model-pipeline'

interface Props {
  datasetId: string | null
  artifactId: string | null
  hasArtifact: boolean
  allTags: string[]
  targetVariables: string[]
  /** PERCENT (0-100) — the same unit `CoreConfig`'s own `trainTestSplit`
   * prop carries. Converted to a fraction once, here, at this panel's own
   * boundary, matching `use-model-training.ts`'s rule. */
  trainTestSplitPercent: number
  algorithms: Algorithm[]
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
  artifactId,
  hasArtifact,
  allTags,
  targetVariables,
  trainTestSplitPercent,
  algorithms,
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

  const splitRatio = trainTestSplitPercent / 100
  const enabledTargetY = hasSequenceAlgorithm ? null : targetY

  const { splitStats, loading, missing, refusal, error } =
    useArtifactSplitStats(
      datasetId,
      artifactId,
      selectedTags,
      enabledTargetY,
      splitRatio,
    )

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
          {splitStats ? (
            <span>
              Cut at{' '}
              <span className="font-medium text-foreground">
                {new Date(splitStats.cut_timestamp).toLocaleString()}
              </span>{' '}
              — {fmtRows(splitStats.train_labelled_rows)} train /{' '}
              {fmtRows(splitStats.test_labelled_rows)} test labelled rows
            </span>
          ) : (
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
