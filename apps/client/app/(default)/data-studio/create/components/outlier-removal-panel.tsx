'use client'

import { useMemo } from 'react'
import { nanoid } from 'nanoid'
import { Filter, Plus, Sigma, Trash2, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DateTimePicker, toDateTimeLocal } from '@/components/date-time-picker'
import { cn } from '@/lib/utils'
import type { CutoffOp } from '@/types/cutoff'
import type { Dataset } from '@/lib/preprocessing'
import {
  clipImpact,
  nearestTimestampIndex,
  statisticalMatchCount,
  type ConditionalRule,
  type CropRange,
  type OutlierAction,
  type StatisticalMethod,
  type StatisticalRule,
} from '@/lib/precleanse'
import {
  describeRangeCutoffSelection,
  reconcileRangeUnit,
} from '@/lib/range-cutoff'
import type { PresetRangeCandidate } from '@/store/dataset-studio'

const OPS: CutoffOp[] = ['>', '>=', '<', '<=', '==', '!=']
const METHODS: { value: StatisticalMethod; label: string }[] = [
  { value: 'zscore', label: 'Z-Score' },
  { value: 'stddev', label: 'Std Dev' },
]

interface Props {
  /** Full tag catalog (rule targets). */
  tags: string[]
  /** Cropped dataset (pre-outlier) — basis for the live "points affected" count. */
  previewDataset: Dataset
  /** Uncropped row timestamps (ascending ISO) — snap target + bounds for the time crop. */
  rawTimestamps: string[]
  /** Shared keep-inside time crop; `null` = full range. Bound to the crop slider. */
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  onStatisticalChange: (rules: StatisticalRule[]) => void
  /**
   * When set, scope the panel to a single tag: only that tag's rules are shown,
   * new rules auto-target it, and the tag selector is hidden. Rules for other
   * tags stay in the underlying arrays untouched (persist across tag switches).
   */
  scopeTag?: string
  /** DS-LAKE-020: proposed range cutoffs from the applied feature preset. */
  presetRangeCandidates?: PresetRangeCandidate[]
  /** True when the applied preset predates range-cutoff support. */
  presetRangeStale?: boolean
  /** Per-tag engineering unit, for the T03 unit-reconciliation gate. */
  tagUnits?: Record<string, string | null>
  /** Null until Step 4 — the T06 labelled-row guard cannot run without it. */
  targetTag?: string | null
}

// ---------------------------------------------------------------------------
// Preset range cutoff (DS-LAKE-020-T05)
// ---------------------------------------------------------------------------

const PRESET_RANGE_PREFIX = 'preset-range'

function presetRangeRuleId(tag: string, bound: 'min' | 'max'): string {
  return `${PRESET_RANGE_PREFIX}:${tag}:${bound}`
}

function isPresetRangeRuleForTag(rule: ConditionalRule, tag: string): boolean {
  return (
    rule.source === 'preset-range' &&
    rule.id.startsWith(`${PRESET_RANGE_PREFIX}:${tag}:`)
  )
}

/**
 * The ConditionalRule(s) a candidate's reconciled bound adds — strict `<`/`>`
 * so a value exactly ON the bound (common with per-tag precision rounding)
 * stays Good, matching the closed-range grammar `[min, max]`. Empty when the
 * unit gate refuses (`applied === null`): never a rule with a guessed number.
 * Rule ids are keyed by TAG ONLY, not by candidate — enabling one candidate
 * for a tag structurally replaces any other candidate's rule for the same
 * tag, which is what makes the intra-config duplicate-row case (T08) resolve
 * to "engineer picks" for free, with no separate picker UI.
 */
function presetRangeRules(
  candidate: PresetRangeCandidate,
  applied: { min: number | null; max: number | null },
  quotedUnit: string | null,
): ConditionalRule[] {
  const provenance = {
    presetId: candidate.presetId,
    configNo: candidate.configNo,
    quoted: candidate.quotedRange,
    unit: quotedUnit,
  }
  const rules: ConditionalRule[] = []
  if (applied.min !== null) {
    rules.push({
      id: presetRangeRuleId(candidate.tag, 'min'),
      tag: candidate.tag,
      op: '<',
      value: applied.min,
      action: 'mark',
      enabled: true,
      source: 'preset-range',
      presetRange: provenance,
    })
  }
  if (applied.max !== null) {
    rules.push({
      id: presetRangeRuleId(candidate.tag, 'max'),
      tag: candidate.tag,
      op: '>',
      value: applied.max,
      action: 'mark',
      enabled: true,
      source: 'preset-range',
      presetRange: provenance,
    })
  }
  return rules
}

/**
 * One tag's preset-range proposal row. Toggling reads/writes `conditionalRules`
 * directly — there is no separate "applied" state to keep in sync, so a rule
 * deleted by hand in the Conditional tab below correctly reads back here as
 * toggled off.
 */
function PresetRangeRow({
  candidate,
  tagUnit,
  previewDataset,
  conditionalRules,
  onConditionalChange,
}: {
  candidate: PresetRangeCandidate
  tagUnit: string | null
  previewDataset: Dataset
  conditionalRules: ConditionalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
}) {
  const reconciliation = useMemo(
    () => reconcileRangeUnit(candidate.parsed, tagUnit),
    [candidate.parsed, tagUnit],
  )
  const activeRule = conditionalRules.find(r =>
    isPresetRangeRuleForTag(r, candidate.tag),
  )
  const isActive = activeRule?.presetRange?.quoted === candidate.quotedRange

  const impact = useMemo(() => {
    if (!reconciliation.applied) return null
    return clipImpact(
      previewDataset,
      candidate.tag,
      reconciliation.applied.min ?? -Infinity,
      reconciliation.applied.max ?? Infinity,
    )
  }, [previewDataset, candidate.tag, reconciliation.applied])

  const toggle = (checked: boolean) => {
    const withoutExisting = conditionalRules.filter(
      r => !isPresetRangeRuleForTag(r, candidate.tag),
    )
    if (!checked || !reconciliation.applied) {
      onConditionalChange(withoutExisting)
      return
    }
    onConditionalChange([
      ...withoutExisting,
      ...presetRangeRules(
        candidate,
        reconciliation.applied,
        reconciliation.quotedUnit,
      ),
    ])
  }

  const refused =
    reconciliation.verdict === 'unknown-unit' ||
    reconciliation.verdict === 'tag-unit-unknown'
  const openEnded =
    candidate.parsed.kind === 'lower' || candidate.parsed.kind === 'upper'

  return (
    <div className="space-y-1 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-36 truncate font-mono text-xs text-foreground">
          {candidate.tag}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {candidate.quotedRange}
        </span>
        {reconciliation.verdict === 'converted' && reconciliation.applied && (
          <span className="text-[11px] text-muted-foreground">
            → applied {reconciliation.applied.min ?? '−∞'} to{' '}
            {reconciliation.applied.max ?? '+∞'} {tagUnit}
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {candidate.presetId} · config {candidate.configNo} · {candidate.sheet}
        </span>
        {impact && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {impact.total} / {impact.points} pts
          </span>
        )}
        <div className="ml-auto">
          <Switch
            checked={isActive}
            onCheckedChange={toggle}
            disabled={refused}
            aria-label={`Toggle preset range cutoff for ${candidate.tag}`}
          />
        </div>
      </div>
      {refused && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {reconciliation.verdict === 'tag-unit-unknown'
            ? 'No unit recorded for this tag, so a kg/hr bound and a t/h bound are indistinguishable here — the quoted number is not applied.'
            : `No known conversion from "${reconciliation.quotedUnit}" to "${tagUnit}" — refusing to apply.`}
        </p>
      )}
      {openEnded && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          Operating window, not a sensor-validity range — marking values Bad
          here can fabricate normal-flow data during a real shutdown or
          turndown. Confirm before enabling.
        </p>
      )}
    </div>
  )
}

function PresetRangeSection({
  candidates,
  tags,
  scopeTag,
  tagUnits,
  previewDataset,
  conditionalRules,
  onConditionalChange,
  targetTag,
  presetRangeStale,
}: {
  candidates: PresetRangeCandidate[]
  tags: string[]
  scopeTag: string | undefined
  tagUnits: Record<string, string | null>
  previewDataset: Dataset
  conditionalRules: ConditionalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  targetTag: string | null
  presetRangeStale: boolean
}) {
  const relevant = useMemo(
    () =>
      candidates.filter(
        c => tags.includes(c.tag) && (!scopeTag || c.tag === scopeTag),
      ),
    [candidates, tags, scopeTag],
  )

  // Cumulative impact: rows with >=1 ENABLED bound violated, not the sum of
  // the per-tag numbers (an AND of several bounds sheds more than any one
  // suggests). Recomputed only when the active set or the frame changes.
  const activeBounds = useMemo(() => {
    const bounds: { tag: string; min: number; max: number }[] = []
    for (const rule of conditionalRules) {
      if (!rule.enabled || rule.source !== 'preset-range') continue
      const existing = bounds.find(b => b.tag === rule.tag)
      const target = existing ?? {
        tag: rule.tag,
        min: -Infinity,
        max: Infinity,
      }
      if (rule.op === '<' && rule.value !== '') target.min = rule.value
      if (rule.op === '>' && rule.value !== '') target.max = rule.value
      if (!existing) bounds.push(target)
    }
    return bounds
  }, [conditionalRules])

  // DS-LAKE-020-T06: remaining-row / remaining-labelled-row guards, fired
  // while the toggles are being flipped — cheap to change here, unlike at
  // Save or at training.
  const guard = useMemo(
    () =>
      describeRangeCutoffSelection({
        dataset: previewDataset,
        activeBounds,
        targetTag,
      }),
    [previewDataset, activeBounds, targetTag],
  )
  const cumulativeImpact = previewDataset.rows.length - guard.remainingRows

  if (relevant.length === 0) {
    // A stale (pre-range-cutoff) preset genuinely has no `range_parsed` on
    // any feature, so `candidates` is empty for a reason the engineer has no
    // other way to see — say so, rather than rendering nothing and looking
    // identical to "this preset has no ranges to propose".
    if (!presetRangeStale) return null
    return (
      <div className="space-y-1 rounded-md bg-muted/40 px-2.5 py-2.5">
        <span className="text-xs font-medium text-foreground">
          Preset range cutoff
        </span>
        <p className="text-[11px] text-muted-foreground">
          This preset was imported before range-cutoff support existed, so it
          carries no parsed ranges. Re-import the same Excel workbook from Step
          1 to enable per-tag range proposals here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-md bg-muted/40 px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          Preset range cutoff
        </span>
        {activeBounds.length > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {cumulativeImpact} rows affected (cumulative)
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Proposed from the applied Excel preset&apos;s Range column. Off by
        default — review before enabling.
      </p>
      <div className="space-y-1.5">
        {relevant.map(candidate => (
          <PresetRangeRow
            key={`${candidate.presetId}:${candidate.rowLabel}`}
            candidate={candidate}
            tagUnit={tagUnits[candidate.tag] ?? null}
            previewDataset={previewDataset}
            conditionalRules={conditionalRules}
            onConditionalChange={onConditionalChange}
          />
        ))}
      </div>
      {guard.refusals.map((text, i) => (
        <p
          key={`refusal-${i}`}
          className="flex items-start gap-1 text-[11px] font-medium text-foreground"
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {text}
        </p>
      ))}
      {guard.warnings.map((text, i) => (
        <p
          key={`warning-${i}`}
          className="flex items-start gap-1 text-[11px] text-muted-foreground"
        >
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          {text}
        </p>
      ))}
    </div>
  )
}

/** mark cell Bad (fillable in 5.2) vs drop just this tag's matched cell. */
function ActionToggle({
  value,
  onChange,
}: {
  value: OutlierAction
  onChange: (a: OutlierAction) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as OutlierAction)}
      className="h-7 shrink-0 overflow-hidden rounded-md border"
    >
      <ToggleGroupItem
        value="mark"
        className="h-7 rounded-none px-2.5 text-[10px] font-semibold tracking-wider uppercase data-[state=on]:bg-amber-500/80 data-[state=on]:text-white"
      >
        Mark
      </ToggleGroupItem>
      <ToggleGroupItem
        value="drop"
        className="h-7 rounded-none border-l px-2.5 text-[10px] font-semibold tracking-wider uppercase data-[state=on]:bg-destructive/80 data-[state=on]:text-white"
      >
        Drop
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

/**
 * Keep-inside time crop, edited via two `DateTimePicker`s and bound to the
 * shared `cropRange` (same state the crop slider + chart inputs drive, so all
 * three stay in sync). A picked datetime is snapped onto the nearest *raw* row
 * timestamp so `precleanse`'s lexical `>=`/`<=` compare stays correct and the
 * window can be widened back to the full span. Selecting the full span clears
 * the crop (`null`), mirroring the slider.
 */
function TimeCropInputs({
  rawTimestamps,
  cropRange,
  onCropChange,
}: {
  rawTimestamps: string[]
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
}) {
  const lastIdx = Math.max(0, rawTimestamps.length - 1)
  const minIso = rawTimestamps[0]
  const maxIso = rawTimestamps[lastIdx]
  const fromIso = cropRange?.from ?? minIso
  const toIso = cropRange?.to ?? maxIso

  const toLocal = (iso?: string) => (iso ? toDateTimeLocal(new Date(iso)) : '')

  const commit = (edge: 'from' | 'to', local: string) => {
    if (!local || rawTimestamps.length === 0 || !minIso || !maxIso) return
    const ms = new Date(local).getTime()
    if (Number.isNaN(ms)) return
    const snapped = rawTimestamps[nearestTimestampIndex(rawTimestamps, ms)]!
    const nextFrom = edge === 'from' ? snapped : (fromIso ?? minIso)
    const nextTo = edge === 'to' ? snapped : (toIso ?? maxIso)
    // Backstop — the pickers' min/max should already block an inverted range.
    if (new Date(nextFrom).getTime() > new Date(nextTo).getTime()) return
    // Full span → clear the crop, matching the slider's "no crop" state.
    if (nextFrom === minIso && nextTo === maxIso) {
      onCropChange(null)
      return
    }
    onCropChange({ from: nextFrom, to: nextTo })
  }

  const disabled = rawTimestamps.length < 2

  return (
    <div className="space-y-2 rounded-md bg-muted/40 px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Time Crop</span>
        {cropRange && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => onCropChange(null)}
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Start</span>
          <DateTimePicker
            value={toLocal(fromIso)}
            onChange={v => commit('from', v)}
            min={toLocal(minIso)}
            max={toLocal(toIso)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">End</span>
          <DateTimePicker
            value={toLocal(toIso)}
            onChange={v => commit('to', v)}
            min={toLocal(fromIso)}
            max={toLocal(maxIso)}
            disabled={disabled}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Keeps rows within the range; drops everything outside.
      </p>
    </div>
  )
}

export function OutlierRemovalPanel({
  tags,
  previewDataset,
  rawTimestamps,
  cropRange,
  onCropChange,
  conditionalRules,
  statisticalRules,
  onConditionalChange,
  onStatisticalChange,
  scopeTag,
  presetRangeCandidates = [],
  presetRangeStale = false,
  tagUnits = {},
  targetTag = null,
}: Props) {
  const firstTag = scopeTag ?? tags[0] ?? ''

  const shownConditional = scopeTag
    ? conditionalRules.filter(r => r.tag === scopeTag)
    : conditionalRules
  const shownStatistical = scopeTag
    ? statisticalRules.filter(r => r.tag === scopeTag)
    : statisticalRules

  const addConditional = () =>
    onConditionalChange([
      ...conditionalRules,
      {
        id: nanoid(6),
        tag: firstTag,
        op: '>',
        value: '',
        action: 'mark',
        enabled: true,
      },
    ])
  const updateConditional = (id: string, patch: Partial<ConditionalRule>) =>
    onConditionalChange(
      conditionalRules.map(r => (r.id === id ? { ...r, ...patch } : r)),
    )
  const removeConditional = (id: string) =>
    onConditionalChange(conditionalRules.filter(r => r.id !== id))

  const addStatistical = () =>
    onStatisticalChange([
      ...statisticalRules,
      {
        id: nanoid(6),
        tag: scopeTag ?? 'ALL',
        method: 'zscore',
        threshold: 3,
        action: 'mark',
        enabled: true,
      },
    ])
  const updateStatistical = (id: string, patch: Partial<StatisticalRule>) =>
    onStatisticalChange(
      statisticalRules.map(r => (r.id === id ? { ...r, ...patch } : r)),
    )
  const removeStatistical = (id: string) =>
    onStatisticalChange(statisticalRules.filter(r => r.id !== id))

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">
          Data Cutting &amp; Outlier Removal
        </h2>
      </div>

      <TimeCropInputs
        rawTimestamps={rawTimestamps}
        cropRange={cropRange}
        onCropChange={onCropChange}
      />

      <PresetRangeSection
        candidates={presetRangeCandidates}
        tags={tags}
        scopeTag={scopeTag}
        tagUnits={tagUnits}
        previewDataset={previewDataset}
        conditionalRules={conditionalRules}
        onConditionalChange={onConditionalChange}
        targetTag={targetTag}
        presetRangeStale={presetRangeStale}
      />

      <Tabs defaultValue="conditional" className="flex w-full flex-col">
        <TabsList className="mb-4 inline-flex w-fit">
          <TabsTrigger value="conditional" className="gap-2">
            <Filter className="h-3.5 w-3.5" /> Conditional
          </TabsTrigger>
          <TabsTrigger value="statistical">
            <Sigma className="h-3.5 w-3.5" /> Statistical
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conditional" className="space-y-2">
          {shownConditional.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              No rules — add one to cut readings by a value condition (e.g.{' '}
              <span className="font-mono">Value &gt; 1000</span>).
            </p>
          )}
          {shownConditional.map(rule => (
            <div
              key={rule.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2',
                !rule.enabled && 'opacity-60',
              )}
            >
              {scopeTag ? (
                <span className="flex h-7 w-36 items-center rounded-md bg-muted px-2.5 font-mono text-xs text-foreground">
                  {rule.tag}
                </span>
              ) : (
                <Select
                  value={rule.tag}
                  onValueChange={v => updateConditional(rule.id, { tag: v })}
                >
                  <SelectTrigger className="h-7 w-36 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map(t => (
                      <SelectItem
                        key={t}
                        value={t}
                        className="font-mono text-xs"
                      >
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={rule.op}
                onValueChange={v =>
                  updateConditional(rule.id, { op: v as CutoffOp })
                }
              >
                <SelectTrigger className="h-7 w-16 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPS.map(op => (
                    <SelectItem
                      key={op}
                      value={op}
                      className="font-mono text-xs"
                    >
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="any"
                placeholder="Value"
                value={rule.value}
                onChange={e =>
                  updateConditional(rule.id, {
                    value:
                      e.target.value === '' ? '' : parseFloat(e.target.value),
                  })
                }
                className="h-7 w-24 font-mono text-xs"
              />
              <ActionToggle
                value={rule.action}
                onChange={a => updateConditional(rule.id, { action: a })}
              />
              {/* Preset-authored, not hand-drawn — stays editable on purpose:
                  `presetCutSignature` (feature-preset-apply.ts) derives the
                  SD&TA card's in-sync flag from this same `source` field, so
                  editing or deleting the rule here is what un-syncs the card
                  and re-enables its Apply button. Locking the row would break
                  that feedback loop. */}
              {rule.source === 'sdta' && (
                <Badge
                  variant="outline"
                  className="h-5 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
                >
                  SD&amp;TA
                </Badge>
              )}
              {/* Same editable-on-purpose reasoning as the SD&TA badge above:
                  deleting or editing this row here is what makes the "Preset
                  range" toggle above read back as off — there is no separate
                  lock, the toggle IS this row's presence. */}
              {rule.source === 'preset-range' && (
                <Badge
                  variant="outline"
                  className="h-5 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
                >
                  Preset range
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={c =>
                    updateConditional(rule.id, { enabled: c })
                  }
                  aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete rule"
                  onClick={() => removeConditional(rule.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs"
            onClick={addConditional}
            disabled={tags.length === 0}
          >
            <Plus className="mr-1 h-3 w-3" /> Add condition
          </Button>
        </TabsContent>

        <TabsContent value="statistical" className="space-y-2">
          {shownStatistical.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              No rules — add one to auto-remove values beyond N standard
              deviations from the mean.
            </p>
          )}
          {shownStatistical.map(rule => {
            const affected = rule.enabled
              ? statisticalMatchCount(previewDataset, rule)
              : 0
            return (
              <div
                key={rule.id}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2',
                  !rule.enabled && 'opacity-60',
                )}
              >
                {scopeTag ? (
                  <span className="flex h-7 w-36 items-center rounded-md bg-muted px-2.5 font-mono text-xs text-foreground">
                    {rule.tag}
                  </span>
                ) : (
                  <Select
                    value={rule.tag}
                    onValueChange={v => updateStatistical(rule.id, { tag: v })}
                  >
                    <SelectTrigger className="h-7 w-36 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL" className="text-xs">
                        All tags
                      </SelectItem>
                      {tags.map(t => (
                        <SelectItem
                          key={t}
                          value={t}
                          className="font-mono text-xs"
                        >
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select
                  value={rule.method}
                  onValueChange={v =>
                    updateStatistical(rule.id, {
                      method: v as StatisticalMethod,
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map(m => (
                      <SelectItem
                        key={m.value}
                        value={m.value}
                        className="text-xs"
                      >
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">±</span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={rule.threshold}
                    onChange={e =>
                      updateStatistical(rule.id, {
                        threshold: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-7 w-16 font-mono text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">σ</span>
                </div>
                <ActionToggle
                  value={rule.action}
                  onChange={a => updateStatistical(rule.id, { action: a })}
                />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {affected} pts
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={c =>
                      updateStatistical(rule.id, { enabled: c })
                    }
                    aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete rule"
                    onClick={() => removeStatistical(rule.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-xs"
            onClick={addStatistical}
            disabled={tags.length === 0}
          >
            <Plus className="mr-1 h-3 w-3" /> Add threshold
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
