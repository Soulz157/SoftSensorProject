'use client'

import { useMemo, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  BarChart3,
  BoxSelect,
  Eye,
  GitCompareArrows,
  LineChart as LineChartIcon,
  ScatterChart,
  Table2,
  WandSparkles,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  classifyColumns,
  ScalerMethod,
  toChartRows,
  toModelReady,
  type BoundedSample,
} from '@/lib/preprocessing'
import { tagDistribution } from '@/lib/data-quality'
import type { TimeRange } from '@/lib/mock-readings'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwScalerConfigsAtom,
  dwEditingDatasetAtom,
  dwModeAtom,
} from '@/store/dataset-studio'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { useArtifactHistogram } from '@/hooks/dataset/artifact/use-artifact-histogram'
import { useArtifactBoxplot } from '@/hooks/dataset/artifact/use-artifact-boxplot'
import { useArtifactScatter } from '@/hooks/dataset/artifact/use-artifact-scatter'
import { useArtifactCorrelation } from '@/hooks/dataset/artifact/use-artifact-correlation'
import { useDatasetArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { useDatasetHistogram } from '@/hooks/dataset/use-dataset-histogram'
import { useDatasetBoxplot } from '@/hooks/dataset/use-dataset-boxplot'
import { useDatasetScatter } from '@/hooks/dataset/use-dataset-scatter'
import { useDatasetCorrelation } from '@/hooks/dataset/use-dataset-correlation'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { useCompareTags } from '@/hooks/dataset/use-compare-tags'
import { RawTrendChart } from '../chart/raw-data-chart'
import { RawReadingsTable } from '../raw-readings-table'
import { TagHistogramChart } from '../chart/tag-histogram-chart'
import { TagBoxplotChart } from '../chart/tag-boxplot-chart'
import { TagScatterChart } from '../chart/tag-scatter-chart'
import { TagCorrelationChart } from '../chart/tag-correlation-chart'
import { CompareTagsPopover } from './compare-tags-popover'
import { FeatureTransformDialog } from '../feature-engineering/transformation-panel'
import { ScrollArea } from '@/components/ui/scroll-area'

interface Props {
  /**
   * DS-LAKE-005B-D-T07: `BoundedSample`, not a bare `Dataset` — both
   * callers (`step-3-1-EDA.tsx`'s `precleanseBounded`,
   * `step-4-feature-engineering.tsx`'s `dwFeaturedDatasetAtom`) now supply
   * one, and `BoundedSample`'s brand is what makes a full-frame regression
   * here a compile error rather than a silent perf/memory footgun (see
   * `BoundedSample`'s own doc comment in `lib/preprocessing.ts`). Every
   * internal call below (`classifyColumns`, `toModelReady`, `toChartRows`,
   * `tagDistribution`, `useDatasetTagSelection`, `RawReadingsTable`) still
   * accepts it unchanged — `BoundedSample extends Dataset`.
   */
  dataset: BoundedSample
  range: TimeRange
  /**
   * MODEL-FLOW-010: an explicit dataset-scoped artifact to analyse. Supplying
   * both makes every server-backed tab read THAT artifact through the
   * dataset-scoped routes, and no `dw*` draft atom takes part in the routing
   * decision — which is what lets a caller outside the data-studio wizard (the
   * model wizard's Dataset Review step) mount this card at all. Left off, the
   * routing falls back to the draft atoms exactly as before, so both
   * data-studio callers are unaffected.
   */
  datasetId?: string | null
  artifactId?: string | null
  /**
   * Feature transforms WRITE `dwScalerConfigsAtom` — the data-studio draft
   * store. A read-only caller must not mount that dialog, or changing a scaler
   * while reviewing a dataset for training would silently edit an unrelated
   * dataset draft. It also must not INHERIT that config: those scalers belong
   * to another wizard's pipeline, so the Raw/Scaled toggle and the stat-table
   * badges are suppressed with it. Defaults to true for the existing callers.
   */
  showTransforms?: boolean
}
type TabStatus = 'no-tags' | 'pending' | 'loading' | 'ready' | 'unavailable'

/** Stable empty ref — a fresh `{}` each render would re-run every memo below. */
const NO_SCALERS: Record<string, ScalerMethod> = {}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/**
 * DS-LAKE-005B-D-T04 (rev). Axis picker for the Scatter tab. Lives in the
 * PARENT for the same reason `CompareTagsPopover` does — `TagScatterChart`
 * stays presentational and takes `xTag`/`yTag` as props. Candidate set is
 * `activeTags` (every tag in the sidebar), NOT `compareTags` — scatter is a
 * pairwise view, so it has no reason to inherit the 2-4 compare cap that
 * histogram/boxplot need.
 */
function AxisSelect({
  axis,
  value,
  tags,
  colorForTag,
  onChange,
}: {
  axis: 'X' | 'Y'
  value: string | null
  tags: string[]
  colorForTag: (tag: string) => string
  onChange: (tag: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {axis}
      </span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-55 cursor-pointer font-mono text-xs">
          <SelectValue placeholder={`Select ${axis} tag`} />
        </SelectTrigger>
        <SelectContent>
          {tags.map(tag => (
            <SelectItem
              key={tag}
              value={tag}
              className="cursor-pointer font-mono text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colorForTag(tag) }}
                />
                {tag}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function DataAnalysisCard({
  dataset,
  range,
  datasetId,
  artifactId,
  showTransforms = true,
}: Props) {
  const { activeTags, focusedTag, colorForTag, selectAll } =
    useDatasetTagSelection(dataset)
  const { compareTags, toggle, atCap } = useCompareTags(activeTags)

  // DS-LAKE-005B-D-T01/T03. Histogram and boxplot tabs read the SERVER
  // artifact, not `dataset` — the two tabs migrated off the full client
  // frame so far (T04-T08 cover scatter/correlation, still untouched).
  //
  // GOLD-if-present-else-draft mirrors step-5-review-save.tsx's
  // `featuresRequested ? goldArtifactId : gateArtifactId` construction, but
  // simplified: this card has no `featuresRequested`/validation-gate
  // concept of its own, so it falls through directly. At Step 3.1 `gold` is
  // always null (Step 4 hasn't run yet) — this correctly resolves to
  // `draftArtifactId` (BRONZE/SILVER, itself null until the first "Save
  // Cleaned Tags" sync, which is exactly the 'pending' case below). At
  // Step 4, `draftArtifactId` (SILVER) is already populated by the time
  // this card mounts, so both tabs show real data immediately and upgrade
  // to GOLD the moment `useDatasetGoldWarm`'s background job lands —
  // without this card doing anything to notice that transition itself.
  // Shared across every server-backed tab (not `histogramArtifactId` —
  // T03 needs the identical id, so this is named for what it IS, not for
  // the first tab that happened to need it).

  const draftId = useAtomValue(dwDraftIdAtom)
  const draftArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const goldArtifactId = useAtomValue(dwDraftGoldArtifactIdAtom)
  const analysisArtifactId = goldArtifactId ?? draftArtifactId
  const editingDataset = useAtomValue(dwEditingDatasetAtom)

  // Route every server-backed tab to whichever leg can actually READ the
  // artifact in play. Edit mode's BRONZE is dataset-gated (adopted at Save,
  // DS-LAKE-017-T01); the draft leg's `where: { id, draftId }` misses it,
  // because that artifact's draftId belongs to the draft that originally
  // created it, not to the fresh draft an edit session opens. That mismatch
  // is why these tabs sat empty in edit mode while Step 3.2 showed BRONZE
  // rows fine — that step reads the hydrated client frame
  // (`useDatasetEditHydration` -> dwRawDatasetAtom), not an artifact id, and
  // that hook deliberately fills only the row atoms.
  //
  // Falls back to the draft leg the moment `analysisArtifactId` appears:
  // once the user Applies in edit mode a real SILVER exists in THIS draft,
  // and staying pinned to the adopted BRONZE would show raw data for the
  // rest of the session.
  // An explicitly supplied artifact wins outright and short-circuits all of
  // the above: the caller has named exactly what to read, so no draft atom
  // gets a say. Without this the model wizard — where every `dw*` atom is
  // null — resolves to no artifact at all and the four server-backed tabs sit
  // on 'pending' forever.
  const explicit = Boolean(datasetId && artifactId)
  const adoptedBronzeId = editingDataset?.adoptedBronzeArtifactId ?? null
  const useDatasetLeg = explicit || (!analysisArtifactId && !!adoptedBronzeId)

  const dsId = explicit
    ? (datasetId ?? null)
    : useDatasetLeg
      ? (editingDataset?.id ?? null)
      : null
  const dsArtifactId = explicit
    ? (artifactId ?? null)
    : useDatasetLeg
      ? adoptedBronzeId
      : null
  const dfId = useDatasetLeg ? null : draftId
  const dfArtifactId = useDatasetLeg ? null : analysisArtifactId

  // Both legs are called unconditionally, one disabled by null ids — hook
  // order must not vary with mode, and a disabled hook fires no request.
  const draftMeta = useDatasetArtifactMetadata(dfId, dfArtifactId)
  const dsMeta = useArtifactMetadata(dsId, dsArtifactId)
  const analysisMetadata = useDatasetLeg ? dsMeta.metadata : draftMeta.metadata

  const artifactTags = useMemo(() => {
    if (!analysisMetadata) return []
    const inArtifact = new Set(analysisMetadata.tags)
    return activeTags.filter(t => inArtifact.has(t))
  }, [analysisMetadata, activeTags])

  // `compareTags` starts `[]` on first render (`useCompareTags` seeds it
  // from an effect, which fires AFTER mount) — without checking this
  // first, that render fell through to 'ready' with zero tags and
  // rendered a false "not enough values" finding instead of the true
  // reason. Same status derivation for both server-backed tabs.
  const mode = useAtomValue(dwModeAtom)
  const hasArtifact = Boolean(analysisArtifactId || dsArtifactId)
  const artifactUnavailable =
    !hasArtifact && mode === 'edit' && !editingDataset?.adoptedBronzeArtifactId

  const statusFor = (hasTags: boolean, loading: boolean): TabStatus =>
    !hasTags
      ? 'no-tags'
      : artifactUnavailable
        ? 'unavailable'
        : !hasArtifact
          ? 'pending'
          : loading
            ? 'loading'
            : 'ready'

  const draftHist = useDatasetHistogram(dfId, dfArtifactId, compareTags)
  const dsHist = useArtifactHistogram(dsId, dsArtifactId, compareTags)
  const { histogram, loading: histogramLoading } = useDatasetLeg
    ? dsHist
    : draftHist
  const histogramStatus = statusFor(compareTags.length > 0, histogramLoading)

  const draftBox = useDatasetBoxplot(dfId, dfArtifactId, compareTags)
  const dsBox = useArtifactBoxplot(dsId, dsArtifactId, compareTags)
  const { boxplot, loading: boxplotLoading } = useDatasetLeg ? dsBox : draftBox
  const boxplotStatus = statusFor(compareTags.length > 0, boxplotLoading)

  // DS-LAKE-005B-D-T04. Scatter's Y follows the focused tag (same
  // convention the old client-only ScatterRegressionChart used via
  // `forcedY`); X is the first OTHER compare tag. No correlation-based
  // auto-default here — that needs the full client frame, which this
  // server-backed tab's whole point is to not require (see
  // `TagScatterChart`'s own doc comment).
  const [xPick, setXPick] = useState<string | null>(null)
  const [yPick, setYPick] = useState<string | null>(null)

  const scatterYTag = useMemo(() => {
    if (yPick && activeTags.includes(yPick)) return yPick
    const focused = focusedTag[0]
    if (focused && activeTags.includes(focused)) return focused
    return activeTags[0] ?? null
  }, [yPick, focusedTag, activeTags])

  const scatterXTag = useMemo(() => {
    if (xPick && activeTags.includes(xPick) && xPick !== scatterYTag)
      return xPick
    return activeTags.find(t => t !== scatterYTag) ?? null
  }, [xPick, activeTags, scatterYTag])

  // Picking a tag already on the other axis SWAPS rather than rejects — an
  // axis flip is the single most common reason to touch these at all, and it
  // keeps both dropdowns showing the full `activeTags` list (no disabled rows).
  const pickX = (tag: string) => {
    if (tag === scatterYTag) setYPick(scatterXTag)
    setXPick(tag)
  }
  const pickY = (tag: string) => {
    if (tag === scatterXTag) setXPick(scatterYTag)
    setYPick(tag)
  }

  const draftScatter = useDatasetScatter(
    dfId,
    dfArtifactId,
    scatterXTag,
    scatterYTag,
  )
  const dsScatter = useArtifactScatter(
    dsId,
    dsArtifactId,
    scatterXTag,
    scatterYTag,
  )
  const { scatter, loading: scatterLoading } = useDatasetLeg
    ? dsScatter
    : draftScatter
  const scatterStatus = statusFor(
    Boolean(scatterXTag && scatterYTag),
    scatterLoading,
  )

  // DS-LAKE-005B-D-T07. Candidate set is `activeTags` (every tag currently
  // in the sidebar), not `compareTags` (the histogram/boxplot compare cap)
  // — the old client-only `CorrelationHeatmap dataset={dataset}` ranged
  // over the full active tag set, and correlation's own value is in
  // surfacing relationships OUTSIDE whatever 2-4 tags happen to be pinned
  // for comparison. The server does its own near-constant filter + ranking
  // + hard cap (DS-LAKE-005B-D-T05a/T05b) over whatever candidate list is
  // sent, so sending more than will be shown is by design, not waste.

  const draftCorr = useDatasetCorrelation(dfId, dfArtifactId, artifactTags)
  const dsCorr = useArtifactCorrelation(dsId, dsArtifactId, artifactTags)
  const { correlation, loading: correlationLoading } = useDatasetLeg
    ? dsCorr
    : draftCorr
  const correlationStatus = statusFor(
    artifactTags.length >= 2,
    correlationLoading,
  )

  const pendingFeatureCount = activeTags.length - artifactTags.length
  const [tab, setTab] = useState('line')
  const [scaledView, setScaledView] = useState(false)
  const [isViewAll, setIsViewAll] = useState(false)

  // Persist the scaler choice to the real pipeline config (applied downstream
  // at Step 5 export via toModelReady) instead of a dead-end local state.
  const [scalerConfigs, setScalerConfigs] = useAtom(dwScalerConfigsAtom)

  const handleSetScaler = (column: string, method: ScalerMethod) => {
    setScalerConfigs(prev => ({ ...prev, [column]: method }))
  }

  // Read-only callers see NO scalers rather than another wizard's. Reading
  // them would be the mirror of the write this flag already blocks: the
  // Raw/Scaled toggle and the stat-table badges would report a transform the
  // reviewer never configured and cannot see the origin of.
  const activeScalers = showTransforms ? scalerConfigs : NO_SCALERS

  const columnGroups = useMemo(() => classifyColumns(dataset), [dataset])

  // How many columns have an explicit scaler — only these transform; the rest
  // pass through. Drives the Raw/Scaled toggle enablement + caption.
  const scaledTagCount = useMemo(
    () => dataset.tags.filter(t => activeScalers[t]).length,
    [dataset.tags, activeScalers],
  )

  // Scale ONLY configured columns: pass 'none' for the rest so toModelReady
  // doesn't default them to min-max.
  const scaledDataset = useMemo(() => {
    const cfg = Object.fromEntries(
      dataset.tags.map(t => [t, activeScalers[t] ?? 'none']),
    ) as Record<string, ScalerMethod>
    return toModelReady(dataset, cfg)
  }, [dataset, activeScalers])

  const showScaled = scaledView && scaledTagCount > 0

  const chartRows = useMemo(() => toChartRows(dataset), [dataset])
  const statRows = useMemo(
    () => activeTags.map(tag => ({ tag, ...tagDistribution(dataset, tag) })),
    [dataset, activeTags],
  )

  // DS-LAKE-005B-D-T07 CORRECTION (advisor-caught): this used to gate on
  // the FULL frame's tag list, which was always populated by the time this
  // card mounted (raw dataset arrives at Step 2, well before Step 3.1/4).
  // `dataset` is now the bounded preview sample, which starts EMPTY and
  // only fills once its own async fetch resolves (`useDatasetBronzeWarm`'s
  // background artifact warm, then `useDatasetFeaturePreviewSample`'s
  // `/rows` call) — a `return null` here made the ENTIRE card vanish
  // during that window, including the four tabs that already handle it
  // gracefully via their own `status === 'pending'`/`'loading'` states.
  // Removed: `raw-data-chart.tsx:225` (Line) and
  // `raw-readings-table.tsx:122` (Raw Table) already render their own
  // empty-state placeholder when `tags`/`rows` are empty, and the stat
  // table below already no-ops via `statRows.length > 0` — nothing here
  // needs a top-level suppress.

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      {/* Header + focus chip */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Data Analysis &amp; Visualization
        </h2>
      </div>

      {artifactUnavailable && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            Charts unavailable for this dataset
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Its raw artifact was reclaimed, or it was saved before raw artifacts
            were kept for editing. The rows below are loaded and usable —
            applying a cleaning rule creates a new artifact and restores the
            charts.
          </p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="flex w-full flex-col">
        <TabsList className="mb-4 inline-flex flex-wrap gap-4 border-b border-border">
          <TabsTrigger value="line" className="gap-2 cursor-pointer">
            <LineChartIcon className="h-3.5 w-3.5" /> Line Chart
          </TabsTrigger>
          <TabsTrigger value="raw-table" className="gap-2 cursor-pointer">
            <Table2 className="h-3.5 w-3.5" /> Raw Table
          </TabsTrigger>
          <TabsTrigger value="histogram" className="gap-2 cursor-pointer">
            <BarChart3 className="h-3.5 w-3.5" /> Histogram
          </TabsTrigger>
          <TabsTrigger value="boxplot" className="gap-2 cursor-pointer">
            <BoxSelect className="h-3.5 w-3.5" /> Box Plot
          </TabsTrigger>
          <TabsTrigger value="scatter" className="gap-2 cursor-pointer">
            <ScatterChart className="h-3.5 w-3.5" /> Scatter Plot
          </TabsTrigger>
          <TabsTrigger value="correlation" className="gap-2 cursor-pointer">
            <GitCompareArrows className="h-3.5 w-3.5" /> Correlation Heatmap
          </TabsTrigger>
        </TabsList>

        {(tab === 'histogram' || tab === 'boxplot') && (
          <div className="mb-3 flex justify-end">
            <CompareTagsPopover
              activeTags={activeTags}
              compareTags={compareTags}
              toggle={toggle}
              atCap={atCap}
              colorForTag={colorForTag}
            />
          </div>
        )}
        {tab === 'scatter' && (
          <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
            <AxisSelect
              axis="X"
              value={scatterXTag}
              tags={activeTags}
              colorForTag={colorForTag}
              onChange={pickX}
            />
            <AxisSelect
              axis="Y"
              value={scatterYTag}
              tags={activeTags}
              colorForTag={colorForTag}
              onChange={pickY}
            />
          </div>
        )}

        {tab === 'line' && (
          <div className="mb-3 flex justify-end">
            <Button
              variant={isViewAll ? 'default' : 'outline'}
              size="sm"
              aria-pressed={isViewAll}
              onClick={() => {
                const next = !isViewAll
                setIsViewAll(next)
                if (next) selectAll()
              }}
              className={cn(
                isViewAll &&
                  'cursor-pointer bg-primary text-primary-foreground',
                'cursor-pointer',
              )}
            >
              <Eye className="mr-2 h-3.5 w-3.5" />
              View all
            </Button>
          </div>
        )}

        {tab === 'raw-table' && (
          <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
            {scaledTagCount > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Scaled — {scaledTagCount} column
                  {scaledTagCount > 1 ? 's' : ''}
                </span>
                <SegmentedToggle
                  ariaLabel="Raw or scaled values"
                  value={scaledView ? 'scaled' : 'raw'}
                  onChange={v => setScaledView(v === 'scaled')}
                  options={[
                    { value: 'raw', label: 'Raw' },
                    { value: 'scaled', label: 'Scaled' },
                  ]}
                />
              </div>
            )}
            {showTransforms && (
              <FeatureTransformDialog
                numericColumns={columnGroups.numeric}
                categoricalColumns={columnGroups.categorical}
                scalerConfigs={scalerConfigs}
                setScalerConfig={handleSetScaler}
              />
            )}
          </div>
        )}

        <div className="min-w-0">
          <TabsContent value="line" className="mt-0">
            <p className="mb-3 text-[11px] text-muted-foreground">
              Preview window — a bounded sample, not the full artifact.
            </p>
            <RawTrendChart
              rows={chartRows}
              tags={activeTags}
              range={range}
              hideTagSelector
              focusedTag={focusedTag}
              isViewAll={isViewAll}
            />
          </TabsContent>
          <TabsContent value="raw-table" className="mt-0">
            <p className="mb-3 text-[11px] text-muted-foreground">
              Preview window — a bounded sample, not the full artifact.
            </p>
            <RawReadingsTable
              dataset={showScaled ? scaledDataset : dataset}
              scalers={activeScalers}
            />
          </TabsContent>
          <TabsContent value="histogram" className="mt-0">
            {histogramStatus === 'ready' && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                Computed on the saved artifact — crop and outlier rules below
                are not reflected here yet.
              </p>
            )}
            <TagHistogramChart
              data={histogram}
              tags={compareTags}
              status={histogramStatus}
            />
          </TabsContent>
          <TabsContent value="boxplot" className="mt-0">
            {boxplotStatus === 'ready' && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                Computed on the saved artifact — crop and outlier rules below
                are not reflected here yet.
              </p>
            )}
            <TagBoxplotChart
              data={boxplot}
              tags={compareTags}
              status={boxplotStatus}
            />
          </TabsContent>
          <TabsContent value="scatter" className="mt-0">
            {scatterStatus === 'ready' && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                Computed on the saved artifact — crop and outlier rules below
                are not reflected here yet.
              </p>
            )}
            <TagScatterChart
              data={scatter}
              xTag={scatterXTag ?? ''}
              yTag={scatterYTag ?? ''}
              status={scatterStatus}
            />
          </TabsContent>
          <TabsContent value="correlation" className="mt-0">
            {correlationStatus === 'ready' && (
              <p className="mb-3 text-[11px] text-muted-foreground">
                Computed on the saved artifact — crop and outlier rules below
                are not reflected here yet.
                {pendingFeatureCount > 0 && (
                  <>
                    {' '}
                    {pendingFeatureCount} derived{' '}
                    {pendingFeatureCount === 1 ? 'feature is' : 'features are'}{' '}
                    not included yet — they appear once feature engineering
                    finishes writing them to the artifact.
                  </>
                )}
              </p>
            )}
            <TagCorrelationChart
              data={correlation}
              status={correlationStatus}
            />
          </TabsContent>
        </div>
      </Tabs>

      {statRows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <ScrollArea className="h-90 w-full overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-3">Tag</TableHead>
                  <TableHead className="text-right">Mean</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">
                    Range
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      (Max-Min)
                    </span>
                  </TableHead>
                  <TableHead className="pr-3 text-right items-center">
                    SD
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statRows.map(row => (
                  <TableRow
                    key={row.tag}
                    className={cn(row.tag === focusedTag[0] && 'bg-muted/50')}
                  >
                    <TableCell className="pl-3">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: colorForTag(row.tag) }}
                        />
                        <span className="truncate font-mono text-xs">
                          {row.tag}
                        </span>
                        {activeScalers[row.tag] &&
                          activeScalers[row.tag] !== 'none' && (
                            <span
                              title={`Feature transform: ${activeScalers[row.tag]} scaler`}
                              className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                            >
                              <WandSparkles className="h-3 w-3 shrink-0" />
                              {activeScalers[row.tag]}
                            </span>
                          )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.mean)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.median)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.max)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.min)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmt(row.range)}
                    </TableCell>
                    <TableCell className="pr-3 text-right font-mono text-xs tabular-nums">
                      {fmt(row.std)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
