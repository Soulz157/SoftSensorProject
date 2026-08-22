'use client'

import type { Dataset } from '@/lib/preprocessing'
import type { CorrelatedArtifactPair } from '@/lib/dataset-stats'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTableView } from '@/app/(default)/data-visualize/components/data-table-view'

interface Props {
  sample: Dataset | null
  sampleLoading: boolean
  sampleError: string | null
  topPairs: CorrelatedArtifactPair[]
  correlationLoading: boolean
}

/**
 * Bounded data preview + top-correlated tag pairs — MODEL-FLOW-010-T05
 * (revised 2026-08-20). Composed from the SAME dataset-scoped hooks
 * `DatasetDetailSheet` already proves (`useArtifactRows`,
 * `useArtifactCorrelation`), NOT `DataAnalysisCard`: that component reads
 * the data-studio DRAFT store (`dw*` atoms), calls draft-only chart routes
 * with no saved-dataset twin, and embeds a mutation UI (feature transforms)
 * — wrong data source and wrong contract for a step that configures
 * nothing. See MODEL-FLOW-010's own finding on this in `docs/feature_list.json`.
 */
export function PreviewCorrelationPanel({
  sample,
  sampleLoading,
  sampleError,
  topPairs,
  correlationLoading,
}: Props) {
  return (
    <div className="space-y-4">
      {!correlationLoading && topPairs.length > 0 && (
        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="border-b border-border bg-muted/30 px-4 py-3">
            <CardTitle className="text-sm font-semibold text-foreground">
              Top correlated tags
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {topPairs.map((p, i) => {
                const isHighCorrelation = Math.abs(p.r) >= 0.8
                return (
                  <li
                    key={`${p.a}-${p.b}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-muted-foreground">{i + 1}.</span>
                      <span className="truncate font-mono font-medium text-foreground">
                        {p.a}
                        <span className="mx-1 text-muted-foreground">↔</span>
                        {p.b}
                      </span>
                    </span>
                    <Badge
                      variant={isHighCorrelation ? 'default' : 'secondary'}
                      className={`shrink-0 font-mono ${isHighCorrelation ? 'bg-primary' : ''}`}
                    >
                      {p.r >= 0 ? '+' : ''}
                      {p.r.toFixed(2)}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <section className="min-w-0 space-y-2">
        <p className="text-sm font-semibold text-foreground">Data preview</p>
        <p className="text-[11px] text-muted-foreground">
          Preview window — a bounded sample, not the full artifact.
        </p>
        {sampleLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : sampleError ? (
          <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
            Could not load a preview — {sampleError}
          </p>
        ) : sample ? (
          <DataTableView dataset={sample} />
        ) : (
          <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
            Could not load a preview for this artifact.
          </p>
        )}
      </section>
    </div>
  )
}
