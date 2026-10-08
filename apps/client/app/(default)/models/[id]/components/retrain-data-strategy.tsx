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
import { useDatasets } from '@/hooks/dataset/use-datasets'
import { datasetVersionService } from '@/services/dataset-version'
import { isAugmentedVersion } from '@/lib/retrain-handoff'
import {
  formatStamp,
  isEmptyRange,
  stampToIso,
  timeBoundsFrom,
  toStamp,
  validationWindowError,
} from '@/lib/retrain-validation-window'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import type { DatasetVersion } from '@/services/dataset-version'
import type { RetrainIncumbent } from '@/services/model-retrain'
import { RetrainFetchNewData } from './retrain-fetch-new-data'
import { RetrainVersionEda } from './retrain-version-eda'
import { CalendarDateTimePicker } from '@/components/calendar-date-time-picker'

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
  onWindowImpossibleChange,
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
  /**
   * True when "New data only" is chosen and the picked version has no day on
   * or after the current version's cut, so NO validation window can exist in
   * it. Lets the parent say that, instead of asking for a window the operator
   * cannot pick.
   */
  onWindowImpossibleChange?: (impossible: boolean) => void
  disabled?: boolean
}) {
  const { datasets, loading: datasetsLoading } = useDatasets(workspaceId)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    initialDatasetId ?? null,
  )
  const [source, setSource] = useState<RetrainNewDataSource>('EXISTING_DATASET')
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  // Which dataset `versions` was last loaded for; `versionsLoading` is
  // DERIVED from a mismatch rather than set synchronously in the effect.
  const [versionsLoadedFor, setVersionsLoadedFor] = useState<string | null>(
    null,
  )
  const versionsLoading =
    !!selectedDatasetId && versionsLoadedFor !== selectedDatasetId
  const [validationWindowEnabled, setValidationWindowEnabled] = useState(false)
  // Held as naive `yyyy-MM-ddTHH:mm` wall-clock stamps and converted to
  // ISO-8601 only on the way out (`stampToIso`) — never through a Date, which
  // could shift the day across a timezone boundary.
  const [windowFrom, setWindowFrom] = useState('')
  const [windowTo, setWindowTo] = useState('')

  useEffect(() => {
    // No synchronous setState here — the dataset picker's own change handler
    // already clears `versions` at selection time, so there is nothing left
    // to reset when `selectedDatasetId` is null.
    if (!selectedDatasetId) return
    let ignore = false
    void datasetVersionService
      .list(selectedDatasetId)
      .then(res => {
        if (!ignore) setVersions(res.data ?? [])
      })
      .finally(() => {
        if (!ignore) setVersionsLoadedFor(selectedDatasetId)
      })
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

  // The first and last READING the chosen version has, to the minute — the
  // guard on the validation window. Read from the artifact's own metadata
  // (the real min/max of its timestamp column), cached per artifact, so it
  // costs one small request per version, not a row read. The time of day
  // matters: python refuses a window that starts before the first reading
  // or ends after the last, and a dataset rarely starts at midnight.
  const { metadata: versionMetadata } = useArtifactMetadata(
    selectedVersion?.artifactId ? selectedDatasetId : null,
    selectedVersion?.artifactId ?? null,
  )
  const dataBounds = useMemo(
    () => timeBoundsFrom(versionMetadata?.startTime, versionMetadata?.endTime),
    [versionMetadata],
  )
  // MODEL-SERVE-021-D03. For New data only the window must start ON OR AFTER
  // the current version's own test data starts — before it, the current
  // version would be "tested" on rows it trained on. Existing + new data has
  // no such floor: its window sits inside the NEW dataset, which never
  // overlaps the incumbent's own rows in the first place. `cutTimestamp` is
  // the same naive wall clock as `versionMetadata`; rounded UP to the minute
  // because python refuses `from < cut` on the exact instant.
  const cutStamp = toStamp(incumbent?.cutTimestamp, 'up')
  const effectiveBounds = useMemo(() => {
    if (!dataBounds) return null
    if (strategy !== 'NEW_DATA_ONLY' || !cutStamp) return dataBounds
    return {
      min: cutStamp > dataBounds.min ? cutStamp : dataBounds.min,
      max: dataBounds.max,
    }
  }, [dataBounds, strategy, cutStamp])
  const windowError = validationWindowError(
    windowFrom,
    windowTo,
    effectiveBounds,
  )
  // The version ends before the cut: every day it holds is one the current
  // version trained on, so there is no day a New-data-only window may use.
  const windowImpossible =
    strategy === 'NEW_DATA_ONLY' &&
    !!selectedVersion &&
    isEmptyRange(effectiveBounds)

  useEffect(() => {
    onWindowImpossibleChange?.(windowImpossible)
  }, [windowImpossible, onWindowImpossibleChange])

  // Reported upward only once BOTH bounds exist. A half-typed range is not a
  // decision, and emitting it would trip the server's both-or-neither
  // refusal while the operator is still filling the second field.
  //
  // Both ends go out minute-exact, as picked. This used to widen whole days
  // to 00:00 / 23:59:59.999, which python refused whenever the data started
  // or ended part-way through a day ("falls outside the new dataset's own
  // range"). A picked end day now defaults to 23:59 clamped to the last
  // reading instead, so it still covers the whole final day of data.
  //
  // New data only has the section forced OPEN (it is required there), but
  // that is a controlled `value`, so `onValueChange` never fires and
  // `validationWindowEnabled` stays false. Reading that flag alone meant a
  // New-data-only window was never reported, and Start could never enable.
  const windowOn = strategy === 'NEW_DATA_ONLY' || validationWindowEnabled
  useEffect(() => {
    // An out-of-range or inverted window is NOT reported: the date inputs'
    // own min/max only limit the picker, a typed date still gets through, and
    // a window reaching past the last day of data would score validation on
    // rows that do not exist.
    if (
      !windowOn ||
      !windowFrom ||
      !windowTo ||
      validationWindowError(windowFrom, windowTo, effectiveBounds) !== null
    ) {
      onValidationWindowChange(null)
      return
    }
    onValidationWindowChange({
      from: stampToIso(windowFrom),
      to: stampToIso(windowTo),
    })
  }, [
    windowOn,
    windowFrom,
    windowTo,
    effectiveBounds,
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
          {/* MODEL-SERVE-019-D01/T02. "Keep Existing Data" is removed — a
              retrain always ingests new data now. Both remaining options
              need a base dataset to add to/replace; when the current
              version has none, neither can be chosen (see the message
              below, in place of a silently disabled group). */}
          <RadioGroup
            value={strategy}
            onValueChange={v => onStrategyChange(v as RetrainDataStrategy)}
            disabled={disabled || !incumbent || !incumbent.baseDataset}
          >
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
              <RadioGroupItem value="AUGMENT_DATA" className="mt-0.5" />
              <span>
                <span className="block font-medium text-foreground">
                  Existing + new data
                </span>
                <span className="block text-muted-foreground">
                  Existing training data plus a new dataset.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
              <RadioGroupItem value="NEW_DATA_ONLY" className="mt-0.5" />
              <span>
                <span className="block font-medium text-foreground">
                  New data only
                </span>
                <span className="block text-muted-foreground">
                  The new dataset alone, without the existing data.
                </span>
              </span>
            </label>
          </RadioGroup>
          {incumbent && !incumbent.baseDataset && (
            <p className="text-xs text-muted-foreground">
              This model&apos;s existing training data could not be found, so a
              retrain has nothing to add new data to. Train a new model in the
              wizard instead.
            </p>
          )}
          {/* Stated once for the group rather than repeated inside each
              option's label. It is the fact that makes a comparison against
              the current version trustworthy at all, so it must be on
              screen, just not twice. The two strategies now differ here:
              Existing + new data still has old rows to test the candidate
              on; New data only replaces them, so the shared validation
              window below is the ONLY way left to compare the two. */}
          {strategy === 'AUGMENT_DATA' && (
            <p className="text-xs text-muted-foreground">
              The result is scored on the current version&apos;s own test rows,
              so the comparison holds.
            </p>
          )}
          {strategy === 'NEW_DATA_ONLY' && (
            <p className="text-xs text-muted-foreground">
              This replaces the training data, so both versions are scored on
              the validation window you set aside below — set one to compare
              them.
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
          // MODEL-SERVE-021-D02. New data only has no frozen slice any more —
          // this window is the ONLY basis left to compare the two versions,
          // so it cannot be collapsed away like it can for Existing + new
          // data, where it is a genuinely optional extra figure.
          collapsible={strategy !== 'NEW_DATA_ONLY'}
          value={
            strategy === 'NEW_DATA_ONLY' || validationWindowEnabled
              ? 'validation-window'
              : ''
          }
          onValueChange={value => {
            const on = value === 'validation-window'
            setValidationWindowEnabled(on)
            if (!on) onValidationWindowChange(null)
          }}
          className="border-t border-border pt-1"
        >
          <AccordionItem value="validation-window" className="border-b-0">
            <AccordionTrigger
              disabled={disabled || strategy === 'NEW_DATA_ONLY'}
              className="items-center py-2 text-xs font-medium hover:no-underline"
            >
              <span className="flex flex-1 items-center gap-2">
                Split Validation data from the new dataset
                <span className="text-[10px] font-normal text-muted-foreground">
                  {strategy === 'NEW_DATA_ONLY'
                    ? 'Required'
                    : validationWindowEnabled
                      ? 'On'
                      : 'Off'}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-1">
              <p className="text-xs text-muted-foreground">
                {strategy === 'NEW_DATA_ONLY' ? (
                  <>
                    These rows are kept out of training. Both the new version
                    and the current version are scored on them, so this is what
                    the comparison is based on.
                  </>
                ) : (
                  <>
                    These rows are kept out of training and scored separately,
                    so you can see how the retrained model does on the new data.
                    The comparison against the current model is unaffected — it
                    is scored on the same test data either way.
                  </>
                )}
              </p>
              {/* Calendars, not native date inputs: a native picker hides
                  every month outside min/max, so the months before the cut
                  vanished and read as a picker that would not scroll. These
                  page across the whole of the data and grey out only the
                  days that cannot be picked. */}
              <div className="flex flex-wrap items-center gap-2">
                <CalendarDateTimePicker
                  label="Validation window start"
                  value={windowFrom}
                  defaultTime="00:00"
                  onChange={setWindowFrom}
                  dataBounds={dataBounds}
                  allowed={{
                    min: effectiveBounds?.min,
                    max: windowTo || effectiveBounds?.max,
                  }}
                  disabled={disabled || windowImpossible}
                  invalid={windowError !== null}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <CalendarDateTimePicker
                  label="Validation window end"
                  value={windowTo}
                  defaultTime="23:59"
                  onChange={setWindowTo}
                  dataBounds={dataBounds}
                  allowed={{
                    min: windowFrom || effectiveBounds?.min,
                    max: effectiveBounds?.max,
                  }}
                  disabled={disabled || windowImpossible}
                  invalid={windowError !== null}
                />
              </div>
              {strategy === 'NEW_DATA_ONLY' && cutStamp && (
                <p className="text-[11px] text-muted-foreground">
                  Must start on or after {formatStamp(cutStamp)} — the current version&apos;s
                  own test data starts there, so it has to be scored on data it
                  has never seen.
                </p>
              )}
              {/* The data's REAL range. This used to print the clamped
                  range under this label, which made the cut look like the
                  end of the data. */}
              {dataBounds && (
                <p className="text-[11px] text-muted-foreground">
                  Data covers {formatStamp(dataBounds.min)} to{' '}
                  {formatStamp(dataBounds.max)}.
                  {effectiveBounds &&
                    !windowImpossible &&
                    effectiveBounds.min !== dataBounds.min &&
                    ` Pickable: ${formatStamp(effectiveBounds.min)} to ${formatStamp(effectiveBounds.max)}.`}
                </p>
              )}
              {windowImpossible && (
                <p role="alert" className="text-[11px] text-destructive">
                  This version has no data on or after {cutStamp && formatStamp(cutStamp)}, so it
                  can&apos;t be used for New data only. Pick a dataset that runs
                  past {cutStamp && formatStamp(cutStamp)}, or choose Existing + new data.
                </p>
              )}
              {windowError && !windowImpossible && (
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
          The current version&apos;s training data could not be found, so a
          retrain has nothing to add new data to.
        </p>
      )}
    </div>
  )
}
