'use client'

import { useEffect, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import { useDatasets } from '@/hooks/dataset/use-datasets'
import { datasetVersionService } from '@/services/dataset-version'
import { isAugmentedVersion } from '@/lib/retrain-handoff'
import {
  dateBoundsFrom,
  validationWindowError,
} from '@/lib/retrain-validation-window'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import type { DatasetVersion } from '@/services/dataset-version'
import type { RetrainIncumbent } from '@/services/model-retrain'
import { RetrainFetchNewData } from './retrain-fetch-new-data'
import { RetrainVersionEda } from './retrain-version-eda'

export type RetrainDataStrategy =
  | 'KEEP_EXISTING'
  | 'AUGMENT_DATA'
  | 'NEW_DATA_ONLY'

/**
 * MODEL-SERVE-017. The strategies that need a dataset selected. Mirrors the
 * server's own `usesNewData` (model-retrain.authorized.dto.ts) — the DTO
 * refuses a strategy/id mismatch in either direction, so the form must use
 * the same rule or it would submit a request the server rejects.
 */
export function retrainUsesNewData(strategy: RetrainDataStrategy): boolean {
  return strategy === 'AUGMENT_DATA' || strategy === 'NEW_DATA_ONLY'
}

/**
 * MODEL-SERVE-017. Where the new data comes from — the operator's SECOND
 * decision, independent of the first. Both sources end at a committed
 * DatasetVersion, so the retrain payload is identical either way and this
 * choice never reaches the server.
 */
export type RetrainNewDataSource = 'EXISTING_DATASET' | 'FETCH_RANGE'

/**
 * MODEL-SERVE-015-T01. Sits ABOVE the Auto/Custom tabs in
 * `ModelRetrainDialog`, not inside either — one strategy applies to whichever
 * finetune mode the operator picks next, and both share the same combined
 * artifact once one is built.
 *
 * "Keep Existing Data" is the 014 default and does not change anything.
 * "Keep Existing + New Data" adds a dataset selector; the base dataset is
 * shown READ-ONLY, resolved server-side from the incumbent's own
 * ModelTrainingRun (`incumbent.baseDataset`) — never editable here, and
 * never derived from `Model.datasetId` (see that field's own comment).
 *
 * The version dropdown lists ONLY versions with a committed artifact
 * (`artifactId !== null`) — an uncommitted version would 422 at trigger
 * time (`assertCompatible`'s own check), so it is filtered out here instead
 * of offered and then refused.
 */
export function RetrainDataStrategy({
  workspaceId,
  modelId,
  incumbent,
  strategy,
  onStrategyChange,
  additionalDatasetVersionId,
  onAdditionalDatasetVersionChange,
  initialDatasetId,
  onValidationWindowChange,
  disabled,
}: {
  workspaceId: string
  /** Needed for the return trip when the fetch path hands off to the wizard. */
  modelId: string
  incumbent: RetrainIncumbent | null
  strategy: RetrainDataStrategy
  onStrategyChange: (strategy: RetrainDataStrategy) => void
  additionalDatasetVersionId: string | null
  onAdditionalDatasetVersionChange: (versionId: string | null) => void
  /**
   * MODEL-SERVE-017. The dataset to open the picker on, set when the
   * operator returns from having just built one in the wizard. Without it
   * the version dropdown stays empty — the version list is fetched per
   * selected dataset, so naming the version alone is not enough to show it.
   */
  initialDatasetId?: string | null
  /**
   * The operator's NEW-DATA validation window, reported upward as ISO-8601
   * or null. Null means "no window" — the parent must send neither bound,
   * since the server refuses a half-open pair rather than guessing.
   *
   * Emitted only when BOTH dates are filled in: a partially typed range is
   * not a decision yet, and forwarding it would surface a server refusal
   * while the operator is still mid-edit.
   */
  onValidationWindowChange: (
    window: { from: string; to: string } | null,
  ) => void
  disabled?: boolean
}) {
  const { datasets, loading: datasetsLoading } = useDatasets(workspaceId)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    initialDatasetId ?? null,
  )
  const [source, setSource] = useState<RetrainNewDataSource>('EXISTING_DATASET')
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [validationWindowEnabled, setValidationWindowEnabled] = useState(false)
  // Held as the raw `yyyy-MM-dd` the date inputs produce, and converted to
  // ISO-8601 only on the way out — keeping the input's own value format as
  // the source of truth avoids a round-trip that can shift the day across a
  // timezone boundary.
  const [windowFrom, setWindowFrom] = useState('')
  const [windowTo, setWindowTo] = useState('')

  useEffect(() => {
    // No synchronous setState here — the dataset picker's own change handler
    // already clears `versions` at selection time, so there is nothing left
    // to reset when `selectedDatasetId` is null.
    if (!selectedDatasetId) return
    let ignore = false
    setVersionsLoading(true)
    void (async () => {
      try {
        const res = await datasetVersionService.list(selectedDatasetId)
        if (!ignore) setVersions(res.data ?? [])
      } finally {
        if (!ignore) setVersionsLoading(false)
      }
    })()
    return () => {
      ignore = true
    }
  }, [selectedDatasetId])

  // Only committed (has a FINAL artifact) versions are offered — an
  // uncommitted one would 422 at trigger time (assertCompatible's own
  // check).
  //
  // MODEL-SERVE-015-T06. Augmented versions are excluded too. Since T06 the
  // output of an augmented retrain is itself registered as a DatasetVersion
  // with a FINAL artifact, so it would otherwise pass the committed filter
  // and be offerable as the NEXT retrain's "new data" — compounding
  // augmentations, with the base rows counted again each round.
  const committedVersions = useMemo(
    () => versions.filter(v => v.artifactId !== null && !isAugmentedVersion(v)),
    [versions],
  )

  // MODEL-SERVE-017. The chosen version's own artifact is what the EDA panel
  // reads; the tag list comes off the dataset, since a version row carries
  // none. Both resolve to null/empty until a real selection exists, which is
  // what keeps the panel from mounting against a half-made choice.
  const selectedVersion = useMemo(
    () => committedVersions.find(v => v.id === additionalDatasetVersionId),
    [committedVersions, additionalDatasetVersionId],
  )
  const selectedDatasetTags = useMemo(
    () => datasets.find(d => d.id === selectedDatasetId)?.tags ?? [],
    [datasets, selectedDatasetId],
  )

  // The first and last day the chosen version actually has data for — the
  // guard on the validation window's date inputs. Read from the artifact's
  // own metadata (the real min/max of its timestamp column), cached per
  // artifact, so it costs one small request per version, not a row read.
  const { metadata: versionMetadata } = useArtifactMetadata(
    selectedVersion?.artifactId ? selectedDatasetId : null,
    selectedVersion?.artifactId ?? null,
  )
  const dataBounds = useMemo(
    () =>
      dateBoundsFrom(versionMetadata?.startTime, versionMetadata?.endTime),
    [versionMetadata],
  )
  const windowError = validationWindowError(windowFrom, windowTo, dataBounds)

  // Reported upward only once BOTH bounds exist. A half-typed range is not a
  // decision, and emitting it would trip the server's both-or-neither
  // refusal while the operator is still filling the second field.
  //
  // The end date is widened to the END of that day: a date input yields
  // midnight, so an inclusive "to 2026-05-31" that stayed at 00:00 would
  // silently exclude almost the whole final day the operator picked.
  useEffect(() => {
    // An out-of-range or inverted window is NOT reported: the date inputs'
    // own min/max only limit the picker, a typed date still gets through, and
    // a window reaching past the last day of data would score validation on
    // rows that do not exist.
    if (
      !validationWindowEnabled ||
      !windowFrom ||
      !windowTo ||
      validationWindowError(windowFrom, windowTo, dataBounds) !== null
    ) {
      onValidationWindowChange(null)
      return
    }
    onValidationWindowChange({
      from: new Date(`${windowFrom}T00:00:00.000Z`).toISOString(),
      to: new Date(`${windowTo}T23:59:59.999Z`).toISOString(),
    })
  }, [
    validationWindowEnabled,
    windowFrom,
    windowTo,
    dataBounds,
    onValidationWindowChange,
  ])

  return (
    // The EDA panel is a SIBLING of the decision card, never inside it —
    // `DataAnalysisCard` is itself a card, and a card within a card is the
    // one nesting this design system rules out outright. Kept full-width at
    // this level so its charts get the column, not the card's inner padding.
    <div className="space-y-3">
      <div className="space-y-3 rounded-md border border-border p-3">
        <div className="space-y-1.5">
          <Label>Training data</Label>
          <RadioGroup
            value={strategy}
            onValueChange={v => onStrategyChange(v as RetrainDataStrategy)}
            disabled={disabled || !incumbent}
          >
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
              <RadioGroupItem value="KEEP_EXISTING" className="mt-0.5" />
              <span>
                <span className="block font-medium text-foreground">
                  Keep Existing Data
                </span>
                <span className="block text-muted-foreground">
                  The current version’s own training data.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
              <RadioGroupItem
                value="AUGMENT_DATA"
                className="mt-0.5"
                disabled={!incumbent?.baseDataset}
              />
              <span>
                <span className="block font-medium text-foreground">
                  Keep Existing + New Data
                </span>
                <span className="block text-muted-foreground">
                  Existing training data plus a new dataset.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
              <RadioGroupItem
                value="NEW_DATA_ONLY"
                className="mt-0.5"
                disabled={!incumbent?.baseDataset}
              />
              <span>
                <span className="block font-medium text-foreground">
                  New Data Only
                </span>
                <span className="block text-muted-foreground">
                  The new dataset alone, without the existing data.
                </span>
              </span>
            </label>
          </RadioGroup>
          {/* Stated once for the group rather than repeated inside each
              option's label. It is the fact that makes a comparison against
              the current version trustworthy at all — especially for New
              Data Only, where the candidate shares none of its training
              rows — so it must be on screen, just not three times. */}
          {retrainUsesNewData(strategy) && (
            <p className="text-xs text-muted-foreground">
              Either way the result is scored on the current version&apos;s own
              test rows, so the comparison holds.
            </p>
          )}
        </div>

        {/* MODEL-SERVE-017. Step 2, and only once step 1 chose new data: WHERE
          that data comes from. The two sources are interchangeable because
          both end at the same thing — a committed DatasetVersion the
          existing AUGMENT_DATA/NEW_DATA_ONLY payload names. */}
        {retrainUsesNewData(strategy) && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="space-y-1.5">
              <Label>Where the new data comes from</Label>
              <RadioGroup
                value={source}
                onValueChange={v => {
                  setSource(v as RetrainNewDataSource)
                  // Clear the pending selection when the source changes — a
                  // version chosen under one source must never be submitted
                  // as though it came from the other.
                  onAdditionalDatasetVersionChange(null)
                }}
                disabled={disabled}
                className="flex gap-2"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem value="EXISTING_DATASET" />
                  <span className="font-medium text-foreground">
                    Additional dataset
                  </span>
                </label>
                <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
                  <RadioGroupItem value="FETCH_RANGE" />
                  <span className="font-medium text-foreground">
                    Fetch a time range
                  </span>
                </label>
              </RadioGroup>
            </div>

            {source === 'FETCH_RANGE' && (
              <RetrainFetchNewData
                baseDatasetId={incumbent?.baseDataset?.datasetId ?? null}
                cutTimestamp={incumbent?.cutTimestamp ?? null}
                modelId={modelId}
                // Only reachable under a new-data strategy, so this narrowing
                // is what the branch already guarantees.
                strategy={strategy as 'AUGMENT_DATA' | 'NEW_DATA_ONLY'}
                disabled={disabled}
              />
            )}

            {source === 'EXISTING_DATASET' && (
              <>
                <div className="space-y-1.5">
                  <Label>Additional dataset</Label>
                  {datasetsLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select
                      value={selectedDatasetId ?? undefined}
                      onValueChange={id => {
                        setSelectedDatasetId(id)
                        setVersions([])
                        onAdditionalDatasetVersionChange(null)
                      }}
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select dataset" />
                      </SelectTrigger>
                      <SelectContent>
                        {datasets.map(ds => (
                          <SelectItem key={ds.id} value={ds.id}>
                            {ds.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {selectedDatasetId && (
                  <div className="space-y-1.5">
                    <Label>Version</Label>
                    {versionsLoading ? (
                      <Skeleton className="h-9 w-full" />
                    ) : committedVersions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No saved version of this dataset has a committed
                        artifact yet.
                      </p>
                    ) : (
                      <Select
                        value={additionalDatasetVersionId ?? undefined}
                        onValueChange={onAdditionalDatasetVersionChange}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select version" />
                        </SelectTrigger>
                        <SelectContent>
                          {committedVersions.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              v{v.versionNumber} · {v.rowCount.toLocaleString()}{' '}
                              rows
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* The new-data validation window. Offered only once a committed
          version is chosen, because it is a range INSIDE that dataset and
          there is nothing to range over before one exists.

          Placed ABOVE "Explore this data": it is a decision that changes
          what the retrain submits, and the EDA panel is reference material —
          the decision reads first, the charts after.

          An accordion rather than a checkbox, and OPEN MEANS ON: the window
          is only submitted while the section is expanded. Collapsing it is
          the old "untick" — it clears what was reported upward, because a
          range the operator can no longer see must not be submitted by a
          later trigger they thought had it turned off. The typed dates are
          kept locally, so reopening restores them rather than making the
          operator type both again. */}
      {selectedVersion?.artifactId && (
        <Accordion
          type="single"
          collapsible
          value={validationWindowEnabled ? 'validation-window' : ''}
          onValueChange={value => {
            const on = value === 'validation-window'
            setValidationWindowEnabled(on)
            if (!on) onValidationWindowChange(null)
          }}
          className="border-t border-border pt-1"
        >
          <AccordionItem value="validation-window" className="border-b-0">
            <AccordionTrigger
              disabled={disabled}
              className="items-center py-2 text-xs font-medium hover:no-underline"
            >
              <span className="flex flex-1 items-center gap-2">
                Split Validation data from the new dataset
                <span className="text-[10px] font-normal text-muted-foreground">
                  {validationWindowEnabled ? 'On' : 'Off'}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-1">
              <p className="text-xs text-muted-foreground">
                These rows are kept out of training and scored separately, so
                you can see how the retrained model does on the new data. The
                comparison against the current model is unaffected — it stays on
                the same frozen rows either way.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  aria-label="Validation window start"
                  className="h-8 w-auto text-xs"
                  disabled={disabled}
                  min={dataBounds?.min}
                  max={windowTo || dataBounds?.max}
                  aria-invalid={windowError !== null}
                  value={windowFrom}
                  onChange={e => setWindowFrom(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  aria-label="Validation window end"
                  className="h-8 w-auto text-xs"
                  disabled={disabled}
                  min={windowFrom || dataBounds?.min}
                  max={dataBounds?.max}
                  aria-invalid={windowError !== null}
                  value={windowTo}
                  onChange={e => setWindowTo(e.target.value)}
                />
              </div>
              {dataBounds && (
                <p className="text-[11px] text-muted-foreground">
                  Data covers {dataBounds.min} to {dataBounds.max}.
                </p>
              )}
              {windowError && (
                <p role="alert" className="text-[11px] text-destructive">
                  {windowError}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* MODEL-SERVE-017. Only once a committed version is chosen — the card
          reads THAT artifact, so there is nothing to show before one exists.
          Collapsed by default: this dialog's job is the decision, and four
          tabs of charts unfurled above the Start button would bury it. */}
      {selectedVersion?.artifactId && (
        <RetrainVersionEda
          datasetId={selectedDatasetId}
          artifactId={selectedVersion.artifactId}
          tags={selectedDatasetTags}
        />
      )}
    </div>
  )
}

/**
 * MODEL-SERVE-015-T01. The dataset the incumbent was ACTUALLY trained on —
 * read-only context, shown on the dialog's right-hand side beside the
 * decisions the operator makes on the left. Resolved server-side off the
 * incumbent's own ModelTrainingRun (`incumbent.baseDataset`), never
 * `Model.datasetId`, and never editable here.
 *
 * Shown for BOTH strategies, not only augmentation: it names what "Keep
 * Existing Data" keeps as much as what "Keep Existing + New Data" adds to.
 */
export function RetrainBaseDataset({
  incumbent,
}: {
  incumbent: RetrainIncumbent | null
}) {
  const base = incumbent?.baseDataset ?? null
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <Label>Base dataset</Label>
      {base ? (
        <div className="space-y-0.5">
          <p className="text-sm font-medium break-words text-foreground">
            {base.datasetName}
          </p>
          {base.versionNumber !== null && (
            <p className="text-xs text-muted-foreground">
              Version v{base.versionNumber}
            </p>
          )}
          <p className="text-xs text-muted-foreground italic">
            Existing training data · read-only
          </p>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          The incumbent&apos;s training data could not be resolved — data
          augmentation is unavailable for this model.
        </p>
      )}
    </div>
  )
}
