'use client'

import { useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Database,
  FileDown,
  GitCompare,
  LayoutGrid,
  Loader2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { DataTableView } from '@/components/data-table-view'
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
import { DatasetVersionsList } from './dataset-versions-list'
import { RetrainVersionEda } from '@/app/(default)/models/[id]/components/retrain-version-eda'

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

/** One fact in the header's key-facts strip — a label/value pair read as a
 *  unit (Law of Proximity), never a boxed KPI card. */
function Fact({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className="mt-0.5 truncate font-mono text-base font-semibold text-foreground"
        title={hint}
      >
        {value}
      </dd>
    </div>
  )
}

/** Section heading for the dialog body — one consistent rhythm instead of a
 *  border box per section. */
function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
      {aside}
    </div>
  )
}

/** Tags shown before "Show all". Past ~two rows a flat wall of badges stops
 *  being scannable (Hick's / Miller's law); the rest stays one click away. */
const TAG_PREVIEW_COUNT = 24

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
  const [showAllTags, setShowAllTags] = useState(false)

  // Which artifact the full-width "Explore this data" section shows. Stored
  // WITH the dataset it was picked for, so opening a different dataset falls
  // back to that dataset's current artifact without a reset effect.
  const [explorePick, setExplorePick] = useState<{
    datasetId: string
    artifactId: string
    label: string
  } | null>(null)
  const pick =
    explorePick && explorePick.datasetId === datasetId ? explorePick : null
  const exploreArtifactId = pick?.artifactId ?? artifactId
  const exploreLabel = pick?.label ?? 'Current artifact'
  const exploreRef = useRef<HTMLElement>(null)

  function handleExplore(nextArtifactId: string, label: string) {
    if (!datasetId) return
    setExplorePick({ datasetId, artifactId: nextArtifactId, label })
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    // After the section re-renders with the new artifact.
    requestAnimationFrame(() =>
      exploreRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      }),
    )
  }

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
  // DS-LAKE-028-T06. `build_column_stats` runs on the frame to_model_ready
  // RETURNED (artifact_service.py:896 -> :936), so every number in this
  // sidecar is in [0,1] for a saved dataset — min/max/mean/median, the std,
  // and DS-LAKE-020-T03's percentiles alike. Inverted here from the same
  // `scalingParams` the data preview above already uses, so the two halves of
  // this sheet cannot disagree about the units of the same tag.
  const perTagStats = useMemo(
    () => perTagStatsOrdered(tags, columnStats?.stats, scalingParams),
    [columnStats, tags, scalingParams],
  )

  const topPairs = useMemo(
    () => topCorrelatedArtifactPairs(correlation),
    [correlation],
  )

  const visibleTags = showAllTags ? tags : tags.slice(0, TAG_PREVIEW_COUNT)
  const hiddenTagCount = tags.length - visibleTags.length

  // Why Compare is unavailable, stated on the control itself rather than in a
  // separate box. "No holdout" and "holdout no longer retained" are different
  // facts and keep different wording.
  const compareBlockedReason = holdoutLoading
    ? 'Loading validation data…'
    : holdoutMissing
      ? 'The validation data was split, but is no longer retained.'
      : holdoutError
        ? `Could not load the validation data — ${holdoutError}`
        : holdout === null
          ? 'No validation data was split from this dataset.'
          : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        {dataset && (
          <>
            {/* Header — identity, actions, key facts, tags. Everything that
                answers "what is this dataset" sits together here (Law of
                Proximity); the body below is for inspecting it. */}
            <DialogHeader className="shrink-0 gap-4 border-b border-border px-6 pt-5 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    {workspaceName}
                  </div>
                  <DialogTitle className="text-xl font-semibold text-balance">
                    {dataset.name}
                  </DialogTitle>
                  {dataset.description && (
                    <DialogDescription className="max-w-[75ch]">
                      {dataset.description}
                    </DialogDescription>
                  )}
                </div>

                {/* Primary actions: large, top-right, where a full-screen
                    view's actions are expected (Fitts's + Jakob's law). */}
                {hasArtifact && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={compareBlockedReason !== null}
                      title={
                        compareBlockedReason ??
                        'Compare against the validation data'
                      }
                      onClick={() => setCompareOpen(true)}
                    >
                      <GitCompare className="mr-2 h-4 w-4" />
                      Compare
                    </Button>
                    {exportHook.status === 'running' ? (
                      <Button disabled>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting…
                      </Button>
                    ) : exportHook.status === 'ready' ? (
                      <Button onClick={() => void exportHook.download()}>
                        <FileDown className="mr-2 h-4 w-4" />
                        Download CSV
                      </Button>
                    ) : (
                      <Button onClick={() => void exportHook.start()}>
                        <FileDown className="mr-2 h-4 w-4" />
                        {exportHook.status === 'error'
                          ? 'Retry export'
                          : 'Export CSV'}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Lineage: sources + stage */}
              <div className="flex flex-wrap items-center gap-1.5">
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

              {/* Key facts — three numbers, read as one strip (Miller's law),
                  not three boxed cards. */}
              <dl className="grid max-w-xl grid-cols-3 gap-6">
                <Fact
                  label="Rows"
                  value={
                    metadataLoading && !dataset.rowCount
                      ? '…'
                      : rowCount.toLocaleString()
                  }
                />
                <Fact label="Features" value={String(tags.length)} />
                <Fact
                  label="Time span"
                  value={
                    metadataLoading
                      ? '…'
                      : metadataError
                        ? 'Unavailable'
                        : timeSpan
                  }
                  hint={metadataError ?? undefined}
                />
              </dl>

              {/* Tags — plain badges directly under the header, no container
                  background. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-muted-foreground">
                  Tags ({tags.length})
                </span>
                {tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No tags recorded.
                  </span>
                ) : (
                  visibleTags.map(t => (
                    <Badge key={t} variant="outline" className="font-mono">
                      {t}
                    </Badge>
                  ))
                )}
                {tags.length > TAG_PREVIEW_COUNT && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowAllTags(v => !v)}
                  >
                    {showAllTags ? (
                      <>
                        Show fewer
                        <ChevronUp className="ml-1 h-3 w-3" />
                      </>
                    ) : (
                      <>
                        Show all · {hiddenTagCount} more
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </DialogHeader>

            {/* Body — scrolls on its own, header stays put. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {hasArtifact ? (
                <div className="grid gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  {/* Main column: the data itself first (serial position). */}
                  <div className="min-w-0 space-y-8">
                    <section className="min-w-0 space-y-2">
                      <SectionTitle>Data preview</SectionTitle>
                      <p className="text-xs text-muted-foreground">
                        Preview window — a bounded sample, not the full
                        artifact.
                        {scalingParams &&
                          ' Values are converted back to engineering units from the dataset’s recorded scaler fit — the stored artifact is scaled, this view is not.'}
                      </p>
                      {sampleLoading ? (
                        <Skeleton className="h-90 w-full rounded-lg" />
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

                    <section className="space-y-2">
                      <SectionTitle>Per-tag statistics</SectionTitle>
                      {/*
                        Stated where the numbers are, not in a tooltip: the
                        stored sidecar is scaled and these are converted back,
                        so they are approximate (the scaler rounds to 3
                        decimals — ±0.001 of each tag's own range).
                      */}
                      {scalingParams && (
                        <p className="text-xs text-muted-foreground">
                          Shown in engineering units, converted from the
                          recorded scaler fit — approximate to ±0.001 of each
                          tag&apos;s range.
                        </p>
                      )}
                      {statsLoading ? (
                        <div className="space-y-2 rounded-lg border border-border p-3">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-6 w-full" />
                          ))}
                        </div>
                      ) : statsMissing ? (
                        // A 404 is NOT an empty result: this artifact has no
                        // sidecar (written before DS-LAKE-005B-A-T07).
                        <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                          This artifact has no statistics sidecar — it was
                          written before per-tag statistics were captured.
                        </p>
                      ) : statsError ? (
                        // A failed request is not an empty result either.
                        <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                          Could not load statistics — {statsError}
                        </p>
                      ) : perTagStats.length === 0 ? (
                        <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                          No statistics available for this artifact.
                        </p>
                      ) : (
                        <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-card hover:bg-card">
                                <TableHead className="sticky top-0 bg-card">
                                  Tag
                                </TableHead>
                                {[
                                  'Mean',
                                  'Median',
                                  'Max',
                                  'Min',
                                  'SD',
                                  'Coverage',
                                ].map(h => (
                                  <TableHead
                                    key={h}
                                    className="sticky top-0 bg-card text-right"
                                  >
                                    {h}
                                  </TableHead>
                                ))}
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
                        </div>
                      )}
                    </section>
                  </div>

                  {/* Side rail: context that informs a decision but is not
                      the data itself. Divided by rules, not boxed. */}
                  <aside className="min-w-0 space-y-6 lg:border-l lg:border-border lg:pl-8">
                    {/* Validation holdout */}
                    <section className="space-y-2">
                      <SectionTitle>Validation data</SectionTitle>
                      {holdoutLoading ? (
                        <Skeleton className="h-10 w-full rounded-lg" />
                      ) : holdout && !holdoutMissing && !holdoutError ? (
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <dt className="text-muted-foreground">
                            Validation rows
                          </dt>
                          <dd className="text-right font-mono text-foreground">
                            {holdout.rowCount.toLocaleString()}
                          </dd>
                          <dt className="text-muted-foreground">Window</dt>
                          <dd className="text-right font-mono text-foreground">
                            {new Date(holdout.holdoutFrom).toLocaleDateString()}
                            {holdout.holdoutTo
                              ? ` – ${new Date(holdout.holdoutTo).toLocaleDateString()}`
                              : ''}
                          </dd>
                          <dt className="text-muted-foreground">Missing</dt>
                          <dd className="text-right font-mono text-foreground">
                            {fmt(holdout.missingPct)}%
                          </dd>
                          <dt className="col-span-2 text-muted-foreground">
                            {rowCount.toLocaleString()} train rows in the
                            current artifact — approximate, cleaning can drop
                            rows after the split.
                          </dt>
                        </dl>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {compareBlockedReason}
                        </p>
                      )}
                    </section>

                    {/* Top correlated tag pairs */}
                    {!corrLoading && topPairs.length > 0 && (
                      <section className="space-y-2 border-t border-border pt-6">
                        <SectionTitle
                          aside={
                            <span className="text-xs text-muted-foreground">
                              |r| ≥ 0.8 highlighted
                            </span>
                          }
                        >
                          Top correlated tags
                        </SectionTitle>
                        <ol className="divide-y divide-border">
                          {topPairs.map((p, i) => {
                            const isHighCorrelation = Math.abs(p.r) >= 0.8
                            return (
                              <li
                                key={`${p.a}-${p.b}`}
                                className="flex items-center justify-between gap-3 py-2 text-xs"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="w-4 shrink-0 text-right text-muted-foreground">
                                    {i + 1}
                                  </span>
                                  <span className="truncate font-mono font-medium text-foreground">
                                    {p.a}
                                    <span className="mx-1 text-muted-foreground">
                                      ↔
                                    </span>
                                    {p.b}
                                  </span>
                                </span>
                                <Badge
                                  variant={
                                    isHighCorrelation ? 'default' : 'secondary'
                                  }
                                  className="shrink-0 font-mono"
                                >
                                  {p.r >= 0 ? '+' : ''}
                                  {p.r.toFixed(2)}
                                </Badge>
                              </li>
                            )
                          })}
                        </ol>
                      </section>
                    )}

                    {/*
                      MODEL-SERVE-015-T06. Deliberately NOT gated on
                      `hasArtifact` in principle — an augmented retrain
                      registers a version without repointing
                      `currentArtifactId`. It is also rendered in the
                      no-artifact branch below for exactly that reason.
                    */}
                    <div className="border-t border-border pt-6">
                      <DatasetVersionsList
                        datasetId={datasetId}
                        selectedArtifactId={exploreArtifactId}
                        onExplore={handleExplore}
                      />
                    </div>

                    {/* DS-LAKE-021-T03 / DS-LAKE-028-T05. What the export
                        contains, stated next to the action's consequences
                        rather than after the click. */}
                    <section className="space-y-2 border-t border-border pt-6">
                      <SectionTitle>About the CSV export</SectionTitle>
                      <p className="text-xs text-muted-foreground">
                        {rowCount.toLocaleString()} rows, {tags.length} columns.
                        Status columns are not included — a Bad reading exports
                        as a blank cell. Values are converted back to{' '}
                        <span className="font-medium text-foreground">
                          engineering units
                        </span>{' '}
                        from the dataset&apos;s recorded scaler fit, so they are
                        approximate — within ±0.001 of each tag&apos;s own
                        range.
                      </p>
                      {exportHook.status === 'error' && (
                        <p className="text-xs text-destructive">
                          {exportHook.error}
                        </p>
                      )}
                    </section>
                  </aside>

                  {/* Explore this data — full width under both columns, open
                      by default. The analysis card's tabs and charts need
                      the room; the Versions list's Explore swaps which
                      artifact it shows. */}
                  {exploreArtifactId && (
                    <section
                      ref={exploreRef}
                      className="min-w-0 scroll-mt-4 space-y-3 border-t border-border pt-8 lg:col-span-2"
                    >
                      <SectionTitle
                        aside={
                          <span className="text-xs text-muted-foreground">
                            Showing:{' '}
                            <span className="font-medium text-foreground">
                              {exploreLabel}
                            </span>
                          </span>
                        }
                      >
                        Explore this data
                      </SectionTitle>
                      <RetrainVersionEda
                        key={exploreArtifactId}
                        collapsible={false}
                        defaultCompareMode="month"
                        datasetId={datasetId}
                        artifactId={exploreArtifactId}
                        tags={tags}
                      />
                    </section>
                  )}
                </div>
              ) : (
                <div className="space-y-8 px-6 py-6">
                  {/* One shared message for the whole body rather than four
                      independent empty states — a dataset with no committed
                      artifact has nothing real to show in any of them. */}
                  <p className="rounded-lg border border-border p-6 text-center text-xs text-muted-foreground">
                    This dataset has no stored artifact yet — statistics,
                    correlations, and a data preview will appear once its rows
                    are committed.
                  </p>
                  <div className="max-w-3xl">
                    <DatasetVersionsList
                      datasetId={datasetId}
                      selectedArtifactId={exploreArtifactId}
                      onExplore={handleExplore}
                    />
                  </div>
                  {pick && (
                    <section
                      ref={exploreRef}
                      className="min-w-0 scroll-mt-4 space-y-3 border-t border-border pt-8"
                    >
                      <SectionTitle
                        aside={
                          <span className="text-xs text-muted-foreground">
                            Showing:{' '}
                            <span className="font-medium text-foreground">
                              {pick.label}
                            </span>
                          </span>
                        }
                      >
                        Explore this data
                      </SectionTitle>
                      <RetrainVersionEda
                        key={pick.artifactId}
                        collapsible={false}
                        defaultCompareMode="month"
                        datasetId={datasetId}
                        artifactId={pick.artifactId}
                        tags={tags}
                      />
                    </section>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>

      <DatasetCompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        datasetId={datasetId}
        artifactId={artifactId}
        availableTags={tags}
        holdout={holdout}
      />
    </Dialog>
  )
}
