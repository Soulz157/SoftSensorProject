'use client'

import { useMemo, useState } from 'react'
import {
  LayoutGrid,
  Tags as TagsIcon,
  Database,
  FileDown,
  Loader2,
  GitCompare,
} from 'lucide-react'
import type { SavedDataset } from '@/store/datasets'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import {
  artifactTimeSpanLabel,
  perTagStatsOrdered,
  topCorrelatedArtifactPairs,
} from '@/lib/dataset-stats'
import { SOURCE_META, STAGE_LABEL } from '@/lib/dataset-source-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTableView } from '@/app/(default)/data-visualize/components/data-table-view'
import type { Dataset } from '@/lib/preprocessing'
import { inverseScale } from '@/lib/inverse-scale'
import { useArtifactColumnStats } from '@/hooks/dataset/artifact/use-dataset-artifact-column-stats'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import { useArtifactCorrelation } from '@/hooks/dataset/artifact/use-artifact-correlation'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import { useArtifactFeatureSpec } from '@/hooks/dataset/artifact/use-artifact-feature-spec'
import { useDatasetExport } from '@/hooks/dataset/use-dataset-export'
import { DatasetCompareModal } from './dataset-compare-modal'

export interface DetailSource {
  name: string
  type: DataSourceKind | null
}

/**
 * Accepts nullish, unlike the pre-server version that took a bare `number`.
 * Every numeric field in `column_stats.json` is optional at the source:
 * min/max/mean/median are null for a tag with zero Good cells, `std` is null
 * below two, and ALL of them are absent (undefined, not null) on a sidecar
 * written before DS-LAKE-005B-D-T09. An em-dash is the honest rendering of
 * all three — `NaN` or `0.00` would each claim something false.
 */
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-lg font-semibold text-foreground">
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

interface Props {
  dataset: SavedDataset | null
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName: string
  sources: DetailSource[]
  /** True while `useDataSources()` is still loading. `sources` is already
   * populated by then (same length as `dataset.sourceIds`), just with every
   * entry resolved to the "Unknown source" placeholder — this tells the
   * header to show a skeleton for that window instead of flashing a wrong
   * answer before the real one arrives. */
  sourcesLoading?: boolean
}

export function DatasetDetailSheet({
  dataset,
  open,
  onOpenChange,
  workspaceName,
  sources,
  sourcesLoading = false,
}: Props) {
  // Every id is gated on `open`. ONE sheet is rendered per page (outside the
  // card grid's `.map`, driven by a single `detailTarget` selection in
  // `datasets-tab.tsx`) — the gate exists so switching `detailTarget` always
  // starts a fresh fetch rather than reusing a previous dataset's in-flight
  // one. Passing null (rather than skipping the hook call) keeps hook order
  // stable — each hook no-ops on a null id.
  const datasetId = open ? (dataset?.id ?? null) : null
  const versionId = open ? (dataset?.currentVersionId ?? null) : null
  const artifactId = open ? (dataset?.currentArtifactId ?? null) : null
  const tags = useMemo(() => dataset?.tags ?? [], [dataset?.tags])

  // Per-tag statistics read the `column_stats.json` SIDECAR, not the frame:
  // one object download regardless of tag count, and `data.parquet` is never
  // opened (DS-LAKE-005B-A-T07). No `tags` argument — the sidecar is
  // whole-artifact by design, so there is nothing to filter server-side.
  const {
    columnStats,
    loading: statsLoading,
    missing: statsMissing,
    error: statsError,
  } = useArtifactColumnStats(datasetId, artifactId)

  // Row count and time span come from the artifact FOOTER, not from any row
  // payload and not from the sidecar (which carries per-tag health, not
  // artifact-level bounds). The old `datasetTimeSpanLabel(ds)` read the
  // first and last row of a client frame — quietly wrong the moment that
  // frame was a bounded sample rather than the whole artifact.
  const {
    metadata,
    loading: metadataLoading,
    error: metadataError,
  } = useArtifactMetadata(datasetId, artifactId)

  const { correlation, loading: corrLoading } = useArtifactCorrelation(
    datasetId,
    artifactId,
    tags,
  )

  const {
    sample,
    loading: sampleLoading,
    error: sampleError,
  } = useArtifactRows(datasetId, artifactId, tags)

  // DS-LAKE-025-T06. A saved dataset's FINAL is model-ready (scaled), not the
  // engineering-unit values its flow produced — same fact the Compare modal's
  // train side had to correct for. `scalingParams` is what each scaler
  // actually FIT; `null` (spec missing, or this tag never got recorded) means
  // this preview cannot state that tag honestly, so it is left scaled rather
  // than shown with an invented value.
  const { featureSpec } = useArtifactFeatureSpec(datasetId, artifactId)
  const scalingParams = featureSpec?.scalingParams ?? null

  const previewSample = useMemo<Dataset | null>(() => {
    if (!sample) return null
    if (!scalingParams) return sample
    return {
      tags: sample.tags,
      rows: sample.rows.map(row => {
        const cells = { ...row.cells }
        for (const tag of sample.tags) {
          const cell = cells[tag]
          if (!cell) continue
          const inverted = inverseScale(cell.value, scalingParams[tag])
          // Leave the cell exactly as-is when it cannot be inverted — never
          // substitute a guessed value, and never drop the cell (Bad/
          // Questionable status must stay visible either way).
          if (inverted !== null) cells[tag] = { ...cell, value: inverted }
        }
        return { ...row, cells }
      }),
    }
  }, [sample, scalingParams])

  // MODEL-FLOW-010-T06 (widened lookup). `holdout: null` with no `missing`/
  // `error` is the normal "no split" case — most datasets have none.
  const {
    holdout,
    loading: holdoutLoading,
    missing: holdoutMissing,
    error: holdoutError,
  } = useArtifactHoldout(datasetId, artifactId)

  const [compareOpen, setCompareOpen] = useState(false)

  const rowCount = metadata?.rowCount ?? dataset?.rowCount ?? 0
  const timeSpan = artifactTimeSpanLabel(metadata?.startTime, metadata?.endTime)
  const hasArtifact = artifactId !== null

  // DS-LAKE-021-T03. `artifactId` here is `dataset.currentArtifactId`, the
  // FINAL a saved dataset always points at — `hasArtifact` is therefore the
  // same "FINAL exists" gate `startExportService` itself enforces
  // server-side (404 otherwise), so a disabled/hidden control here never
  // needs to render a 404 error state.
  const exportHook = useDatasetExport(datasetId)

  // Ordered by the DATASET's own tag list, not the sidecar's key order: the
  // Tags section directly above renders `dataset.tags`, and two lists in one
  // sheet disagreeing on order is a bug report waiting to happen. Shared with
  // the Model wizard's Dataset Review step (MODEL-FLOW-010) via
  // `lib/dataset-stats.ts` so both agree on row order for the same artifact.
  const perTagStats = useMemo(
    () => perTagStatsOrdered(tags, columnStats?.stats),
    [columnStats, tags],
  )

  const topPairs = useMemo(
    () => topCorrelatedArtifactPairs(correlation),
    [correlation],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto overflow-x-hidden p-0 data-[side=right]:sm:max-w-2xl"
      >
        {dataset && (
          <>
            {/* Header — identity + lineage */}
            <SheetHeader className="gap-2 border-b border-border p-5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <LayoutGrid className="h-3.5 w-3.5" />
                {workspaceName}
              </div>
              <SheetTitle className="text-lg">{dataset.name}</SheetTitle>
              {dataset.description && (
                <SheetDescription>{dataset.description}</SheetDescription>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {sourcesLoading ? (
                  sources.map((_, i) => (
                    <Skeleton key={i} className="h-5 w-24 rounded-full" />
                  ))
                ) : sources.length === 0 ? (
                  <Badge variant="secondary">No source</Badge>
                ) : (
                  sources.map((s, i) => {
                    const meta = s.type ? SOURCE_META[s.type] : null
                    const Icon = meta?.icon ?? Database
                    return (
                      <Badge
                        key={`${s.name}-${i}`}
                        variant="secondary"
                        className="gap-1.5 font-medium text-foreground"
                      >
                        <Icon className="h-3 w-3 text-primary" />
                        {meta?.label ?? 'Source'}
                        <span className="text-muted-foreground">
                          · {s.name}
                        </span>
                      </Badge>
                    )
                  })
                )}
                {dataset.currentArtifactType && (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {STAGE_LABEL[dataset.currentArtifactType]}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              {/* KPI overview */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <KpiCard
                  label="Rows"
                  value={
                    metadataLoading && !dataset.rowCount
                      ? '…'
                      : rowCount.toLocaleString()
                  }
                />
                <KpiCard label="Features" value={String(tags.length)} />
                <KpiCard
                  label="Time span of data"
                  value={
                    metadataLoading
                      ? '…'
                      : metadataError
                        ? 'Unavailable'
                        : timeSpan
                  }
                  sub={metadataError ?? undefined}
                />
              </div>

              {/* DS-LAKE-021-T03. Only offered once a FINAL artifact
                  exists — `startExportService` itself asserts this
                  server-side. Status columns are dropped and a Bad-status
                  cell exports as a blank field, never the numeric 0.0 the
                  Parquet stores — the same fact the CSV's own reader
                  needs, stated here before the click, not after. */}
              {hasArtifact && (
                <section className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      Export
                    </p>
                    {exportHook.status === 'idle' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        onClick={() => void exportHook.start()}
                      >
                        <FileDown className="mr-2 h-3.5 w-3.5" />
                        Export CSV
                      </Button>
                    )}
                    {exportHook.status === 'running' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        disabled
                      >
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Exporting…
                      </Button>
                    )}
                    {exportHook.status === 'ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        onClick={() => void exportHook.download()}
                      >
                        <FileDown className="mr-2 h-3.5 w-3.5" />
                        Download CSV
                      </Button>
                    )}
                    {exportHook.status === 'error' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        onClick={() => void exportHook.start()}
                      >
                        <FileDown className="mr-2 h-3.5 w-3.5" />
                        Retry export
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {rowCount.toLocaleString()} rows, {tags.length} columns.
                    Status columns are not included — a Bad reading exports as a
                    blank cell.
                  </p>
                  {exportHook.status === 'error' && (
                    <p className="text-xs text-destructive">
                      {exportHook.error}
                    </p>
                  )}
                </section>
              )}

              {/* Validation holdout. The Compare button stays disabled in
                  every branch — there is no route yet that serves the
                  holdout's rows for a chart, only its footer (window, row
                  count, missing %). "No holdout was split" and "the holdout
                  data is no longer retained" are different facts and must
                  not share a message, the same discipline the stats section
                  below already applies to statsMissing vs statsError. */}
              {hasArtifact && (
                <section className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      Validation Data
                    </p>
                  </div>
                  {holdoutLoading ? (
                    <Skeleton className="h-14 w-full rounded-lg" />
                  ) : holdoutMissing ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        A validation data was split, but its data is no longer
                        retained.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        disabled
                      >
                        <GitCompare className="mr-2 h-3.5 w-3.5" />
                        Compare
                      </Button>
                    </>
                  ) : holdoutError ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Could not load the validation data — {holdoutError}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        disabled
                      >
                        <GitCompare className="mr-2 h-3.5 w-3.5" />
                        Compare
                      </Button>
                    </>
                  ) : holdout === null ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        No validation data was split from this dataset.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        disabled
                      >
                        <GitCompare className="mr-2 h-3.5 w-3.5" />
                        Compare
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {rowCount.toLocaleString()} rows in the current artifact
                        (train, approximate — cleaning can drop rows after the
                        split) · {holdout.rowCount.toLocaleString()} validation
                        rows ·{' '}
                        {new Date(holdout.holdoutFrom).toLocaleDateString()}
                        {holdout.holdoutTo
                          ? ` – ${new Date(holdout.holdoutTo).toLocaleDateString()}`
                          : ''}{' '}
                        · {fmt(holdout.missingPct)}% missing
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-fit"
                        onClick={() => setCompareOpen(true)}
                      >
                        <GitCompare className="mr-2 h-3.5 w-3.5" />
                        Compare
                      </Button>
                    </>
                  )}
                </section>
              )}

              {/* Tags scroll area */}
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <TagsIcon className="h-4 w-4 text-primary" />
                  Tags ({tags.length})
                </div>
                <ScrollArea className="h-40 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(t => (
                      <Badge key={t} variant="outline" className="font-mono">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </section>

              {hasArtifact ? (
                <>
                  {/* Per-tag statistics */}
                  <section className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      Per-tag statistics
                    </p>
                    {statsLoading ? (
                      <div className="space-y-2 rounded-lg border border-border p-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Skeleton key={i} className="h-6 w-full" />
                        ))}
                      </div>
                    ) : statsMissing ? (
                      // A 404 is NOT the same as an empty result, and must not
                      // render as one: it means this artifact has no sidecar
                      // (written before DS-LAKE-005B-A-T07, or by a write path
                      // that produced none). Showing "no statistics" flat would
                      // read as "this dataset has no tags", which is false and
                      // sends someone looking for the wrong bug.
                      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                        This artifact has no statistics sidecar — it was written
                        before per-tag statistics were captured.
                      </p>
                    ) : statsError ? (
                      // A failed request is not an empty result. Falling through to the
                      // empty state below would blame the artifact for a transport problem
                      // and send someone looking for missing data that is actually there.
                      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                        Could not load statistics — {statsError}
                      </p>
                    ) : perTagStats.length === 0 ? (
                      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                        No statistics available for this artifact.
                      </p>
                    ) : (
                      <ScrollArea className="h-56 rounded-lg border border-border">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-card">
                              <TableHead className="sticky top-0 bg-card">
                                Tag
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                Mean
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                Median
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                Max
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                Min
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                SD
                              </TableHead>
                              <TableHead className="sticky top-0 bg-card text-right">
                                Coverage
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {perTagStats.map(s => (
                              <TableRow key={s.tag}>
                                <TableCell className="font-mono text-foreground">
                                  {s.tag}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.mean)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.median)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.max)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.min)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.std)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {fmt(s.coverage)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    )}
                  </section>

                  {/* Top correlated tag pairs */}
                  {!corrLoading && topPairs.length > 0 && (
                    <Card className="overflow-hidden shadow-sm">
                      <CardHeader className="bg-muted/30 px-4 py-3 border-b border-border">
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
                                  <span className="text-muted-foreground">
                                    {i + 1}.
                                  </span>
                                  <span className="truncate font-mono text-foreground font-medium">
                                    {p.a}
                                    <span className="text-muted-foreground mx-1">
                                      ↔
                                    </span>
                                    {p.b}
                                  </span>
                                </span>
                                <Badge
                                  variant={
                                    isHighCorrelation ? 'default' : 'secondary'
                                  }
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

                  {/* Data preview */}
                  <section className="min-w-0 space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      Data preview
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Preview window — a bounded sample, not the full artifact.
                      {scalingParams &&
                        ' Values are converted back to engineering units from the dataset’s recorded scaler fit — the stored artifact is scaled, this view is not.'}
                    </p>
                    {sampleLoading ? (
                      <Skeleton className="h-64 w-full rounded-lg" />
                    ) : sampleError ? (
                      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                        Could not load a preview — {sampleError}
                      </p>
                    ) : previewSample ? (
                      <DataTableView dataset={previewSample} />
                    ) : (
                      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                        Could not load a preview for this artifact.
                      </p>
                    )}
                  </section>
                </>
              ) : (
                // One shared message for the whole lower half rather than four
                // independent empty states (stats/correlation/preview each
                // reading differently) — a dataset with no committed artifact
                // yet has nothing real to show in any of them, for the same
                // reason, so it should say so once.
                <div className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
                  This dataset has no stored artifact yet — statistics,
                  correlations, and a data preview will appear once its rows are
                  committed.
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>

      <DatasetCompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        datasetId={datasetId}
        artifactId={artifactId}
        availableTags={tags}
        holdout={holdout}
      />
    </Sheet>
  )
}
