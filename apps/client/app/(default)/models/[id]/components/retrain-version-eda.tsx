'use client'

import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataAnalysisCard } from '@/app/(default)/data-studio/create/components/processing/data-analysis-card'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import { brandBoundedSample } from '@/lib/preprocessing'
import { PREVIEW_MAX_ROWS } from '@/lib/downsample'
import type { EdaWindowControl, TimeWindow } from '@/lib/time-window'

/**
 * MODEL-SERVE-017. Read-only EDA for the dataset version a retrain is about
 * to train on, so the operator can look at the data before committing
 * container time to it.
 *
 * Reuses `DataAnalysisCard` in its store-agnostic mode — the same way the
 * model wizard's Dataset Review step already mounts it. Supplying both
 * `datasetId` and `artifactId` routes every server-backed tab through the
 * dataset-scoped endpoints, so no `dw*` draft atom takes part: without that,
 * this card would read whichever dataset draft the Data Studio wizard
 * happened to leave behind.
 *
 * `showTransforms` is off, and that is a correctness requirement rather than
 * a layout choice: the transforms dialog WRITES `dwScalerConfigsAtom`, so
 * changing a scaler while reviewing a dataset here would silently edit an
 * unrelated dataset draft's pipeline.
 *
 * Collapsed by default. The retrain dialog's job is the decision; the charts
 * are for the moment the operator wants to check one, and four tabs of
 * analysis unfurled above the Start button would bury it.
 */
export function RetrainVersionEda({
  datasetId,
  artifactId,
  tags,
}: {
  datasetId: string | null
  artifactId: string | null
  tags: string[]
}) {
  const [open, setOpen] = useState(false)
  const [period, setPeriod] = useState<TimeWindow | null>(null)

  // Nothing is fetched until the section is opened — an operator who never
  // expands it pays no request, and this sits inside a dialog that most
  // often gets closed again.
  const {
    sample,
    totalRowCount,
    loading: sampleLoading,
  } = useArtifactRows(open ? datasetId : null, open ? artifactId : null, tags, {
    maxRows: PREVIEW_MAX_ROWS,
    timeWindow: period,
  })

  const edaWindow = useMemo<EdaWindowControl>(
    () => ({
      value: period,
      onChange: setPeriod,
      loading: sampleLoading,
      totalRows: totalRowCount,
      loadedRows: sample?.rows.length ?? 0,
    }),
    [period, sampleLoading, totalRowCount, sample],
  )

  const boundedSample = useMemo(
    () => brandBoundedSample(sample ?? { tags: [], rows: [] }),
    [sample],
  )

  if (!datasetId || !artifactId) return null

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between px-0 py-1 text-xs font-medium"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Explore this data
        <ChevronDown
          aria-hidden="true"
          className={open ? 'h-4 w-4 rotate-180' : 'h-4 w-4'}
        />
      </Button>

      {open && (
        <DataAnalysisCard
          dataset={boundedSample}
          // Only the trend chart's x-axis tick format. This panel has no
          // range of its own — the period picker inside owns the real window.
          range="7d"
          datasetId={datasetId}
          artifactId={artifactId}
          showTransforms={false}
          // The only visibility control available here: there is no wizard
          // tag sidebar in a dialog.
          showTagSelector
          edaWindow={edaWindow}
        />
      )}
    </div>
  )
}
