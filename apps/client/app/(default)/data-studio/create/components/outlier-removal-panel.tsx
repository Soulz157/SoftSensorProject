'use client'

import { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import {
  Filter,
  MoveHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sigma,
  Trash2,
} from 'lucide-react'
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
import { CalendarDateTimePicker } from '@/components/calendar-date-time-picker'
import {
  snapStampIndex,
  stampFromTimestamp,
  wallClockKey,
} from '@/lib/date-stamp'
import { cn } from '@/lib/utils'
import type { CutoffOp } from '@/types/cutoff'
import type { Dataset } from '@/lib/preprocessing'
import {
  conditionalRuleCanClip,
  statisticalMatchCount,
  type ConditionalRule,
  type CropRange,
  type OutlierAction,
  type StatisticalMethod,
  type StatisticalRule,
} from '@/lib/precleanse'
import { SegmentedToggle } from '@/components/segmented-toggle'
import {
  isPresetRangeEdited,
  presetRangeEditError,
  presetRangeWindow,
  rangeActionOf,
  toRuleAction,
  type RangeAction,
} from '@/lib/range-cutoff'
import { RANGE_ACTION_OPTIONS, RangeDivider } from './preset-range-card'

const OPS: CutoffOp[] = ['>', '>=', '<', '<=', '==', '!=']
/** DS-LAKE-032-D09. Ops allowed on either side of a range rule, so it always
 * reads as an interval: `low <= TAG < high`. */
const RANGE_OPS = ['<', '<='] as const
type RangeOp = (typeof RANGE_OPS)[number]
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
  /**
   * DS-LAKE-038. Per-tag engineering unit, so a preset range reads with the
   * same unit as the Preset range card (its stored bounds are already in the
   * tag's unit). Absent = no unit shown.
   */
  tagUnits?: Record<string, string | null>
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
 * Keep-inside time crop — the ONE time crop in this step (DS-LAKE-032-D07;
 * the duplicate under "Data Cut-Off & Cleansing" was removed). Bound to the
 * shared `cropRange`, the same state the crop slider drives, so both stay in
 * sync. Edited with `CalendarDateTimePicker`, the design-system picker for a
 * date-time range over data. A picked stamp is snapped onto a real raw
 * timestamp (`snapStampIndex`: a start keeps the first reading at or after
 * it, an end the last at or before it) so `precleanse`'s lexical `>=`/`<=`
 * compare stays correct. Selecting the full span clears the crop (`null`),
 * mirroring the slider.
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

  const dataBounds = useMemo(
    () =>
      minIso && maxIso
        ? { min: stampFromTimestamp(minIso), max: stampFromTimestamp(maxIso) }
        : null,
    [minIso, maxIso],
  )
  const fromStamp = fromIso ? stampFromTimestamp(fromIso) : ''
  const toStamp = toIso ? stampFromTimestamp(toIso) : ''

  const commit = (edge: 'from' | 'to', stamp: string) => {
    if (!stamp || rawTimestamps.length === 0 || !minIso || !maxIso) return
    const index = snapStampIndex(
      rawTimestamps,
      stamp,
      edge === 'from' ? 'start' : 'end',
    )
    const snapped = rawTimestamps[index]
    if (!snapped) return
    const nextFrom = edge === 'from' ? snapped : (fromIso ?? minIso)
    const nextTo = edge === 'to' ? snapped : (toIso ?? maxIso)
    // Backstop — each picker's `allowed` should already block an inverted
    // range. Compared as wall-clock keys, not list positions: the bound NOT
    // being edited may be a crop restored from a saved config, written in a
    // different form than the re-fetched rows, and would not be found.
    if (wallClockKey(nextFrom) > wallClockKey(nextTo)) return
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
          <CalendarDateTimePicker
            label="Time crop start"
            value={fromStamp}
            onChange={v => commit('from', v)}
            dataBounds={dataBounds}
            allowed={{ min: dataBounds?.min, max: toStamp || dataBounds?.max }}
            defaultTime="00:00"
            disabled={disabled}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">End</span>
          <CalendarDateTimePicker
            label="Time crop end"
            value={toStamp}
            onChange={v => commit('to', v)}
            dataBounds={dataBounds}
            allowed={{
              min: fromStamp || dataBounds?.min,
              max: dataBounds?.max,
            }}
            defaultTime="23:59"
            disabled={disabled}
            className="w-full"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Keeps rows within the range; drops everything outside.
      </p>
    </div>
  )
}

type Bound = 'min' | 'max'

const fmtInput = (n: number | null) => (n === null ? '' : String(n))
const parseInput = (text: string): number | null =>
  text.trim() === '' ? null : Number(text)

/**
 * DS-LAKE-038. One preset range, editable: `TAG │ [low] ≤ x ≤ [high] unit`.
 *
 * The inputs hold a local DRAFT so typing passes through states that are not
 * yet a valid window ("3", "30.", "1e"); a value is written to the rules only
 * when the whole window is valid (`presetRangeEditError`), so a rule is never
 * left half-typed, empty or with low >= high. The draft re-syncs whenever the
 * rules change from elsewhere (the card's Reset) without wiping a keystroke
 * that parsed to the value already stored.
 *
 * An edited bound is flagged here and on the Preset range card, which also
 * shows what the preset said.
 */
function PresetRangeRuleRow({
  tag,
  rules,
  unit,
  onBoundChange,
  onActionChange,
  onReset,
  onRemove,
}: {
  tag: string
  rules: ConditionalRule[]
  unit: string | null
  onBoundChange: (tag: string, bound: Bound, value: number) => void
  onActionChange: (tag: string, action: RangeAction) => void
  onReset: (tag: string) => void
  onRemove: (tag: string) => void
}) {
  const window = presetRangeWindow(rules)
  const [draft, setDraft] = useState(() => ({
    min: fmtInput(window.min),
    max: fmtInput(window.max),
  }))
  // Re-sync from the rules when they change elsewhere - but only a side whose
  // stored value differs from what the draft already parses to, so "30." is
  // not rewritten to "30" mid-typing.
  const [seen, setSeen] = useState(window)
  if (seen.min !== window.min || seen.max !== window.max) {
    setSeen(window)
    setDraft(d => ({
      min: parseInput(d.min) === window.min ? d.min : fmtInput(window.min),
      max: parseInput(d.max) === window.max ? d.max : fmtInput(window.max),
    }))
  }

  const draftMin = window.min === null ? null : parseInput(draft.min)
  const draftMax = window.max === null ? null : parseInput(draft.max)
  const missing =
    (window.min !== null && draft.min.trim() === '') ||
    (window.max !== null && draft.max.trim() === '')
  const error = missing
    ? 'Enter a value'
    : presetRangeEditError(draftMin, draftMax)

  const change = (bound: Bound, text: string) => {
    const next = { ...draft, [bound]: text }
    setDraft(next)
    const nextMin = window.min === null ? null : parseInput(next.min)
    const nextMax = window.max === null ? null : parseInput(next.max)
    const value = bound === 'min' ? nextMin : nextMax
    if (value === null || presetRangeEditError(nextMin, nextMax)) return
    onBoundChange(tag, bound, value)
  }

  const actions = new Set(rules.map(rangeActionOf))
  const action: RangeAction | 'mixed' =
    actions.size > 1 ? 'mixed' : actions.has('clip') ? 'clip' : 'exclude'
  const edited = isPresetRangeEdited(rules)
  const quoted = rules[0]?.presetRange?.quoted

  const input = (bound: Bound, label: string) => (
    <Input
      type="number"
      step="any"
      aria-label={`${tag} ${label}`}
      aria-invalid={error ? true : undefined}
      value={draft[bound]}
      onChange={e => change(bound, e.target.value)}
      className="h-7 w-20 font-mono text-xs"
    />
  )

  return (
    <div className="space-y-1 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-7 min-w-0 items-center gap-3 font-mono text-xs text-foreground"
          title={quoted ? `Quoted: ${quoted}` : undefined}
        >
          <span className="truncate">{tag}</span>
          <RangeDivider />
        </span>
        {/* Read left to right as the kept window: [low] ≤ x ≤ [high]. */}
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {window.min !== null && (
            <>
              {input('min', 'lower bound')}
              <span>≤</span>
            </>
          )}
          <span className="text-foreground">x</span>
          {window.max !== null && (
            <>
              <span>≤</span>
              {input('max', 'upper bound')}
            </>
          )}
          {unit && <span>{unit}</span>}
        </span>
        <SegmentedToggle<RangeAction | 'mixed'>
          ariaLabel={`What to do with ${tag} readings outside the range`}
          value={action}
          onChange={a => {
            if (a !== 'mixed') onActionChange(tag, a)
          }}
          options={RANGE_ACTION_OPTIONS}
        />
        <Badge
          variant="outline"
          className="h-5 gap-1 px-1.5 text-[10px] font-normal text-muted-foreground"
        >
          Preset range
        </Badge>
        {edited && (
          <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px]">
            <Pencil className="size-3" />
            Edited
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {edited && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Reset ${tag} to the preset range`}
              title="Reset to the preset range"
              onClick={() => onReset(tag)}
              className="text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* No enable switch: the card's checkbox is the on/off, and
              removing here is the same act as unticking it there. */}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove preset range for ${tag}`}
            onClick={() => onRemove(tag)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error} — not applied
        </p>
      )}
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
  tagUnits = {},
}: Props) {
  const firstTag = scopeTag ?? tags[0] ?? ''

  const shownConditional = scopeTag
    ? conditionalRules.filter(r => r.tag === scopeTag)
    : conditionalRules
  // DS-LAKE-038. A preset range is TWO rules (`< min`, `> max`) but one idea,
  // so it is listed as one row per tag in the Preset range card's own format
  // (`TAG │ 30 ≤ x ≤ 100 kg/h`); hand-written rules keep their editable rows.
  const handRules = shownConditional.filter(r => r.source !== 'preset-range')
  const presetGroups: { tag: string; rules: ConditionalRule[] }[] = []
  for (const rule of shownConditional) {
    if (rule.source !== 'preset-range') continue
    const group = presetGroups.find(g => g.tag === rule.tag)
    if (group) group.rules.push(rule)
    else presetGroups.push({ tag: rule.tag, rules: [rule] })
  }
  const setPresetAction = (tag: string, action: RangeAction) =>
    onConditionalChange(
      conditionalRules.map(r =>
        r.source === 'preset-range' && r.tag === tag
          ? { ...r, action: toRuleAction(action) }
          : r,
      ),
    )
  const setPresetBound = (tag: string, bound: Bound, value: number) =>
    onConditionalChange(
      conditionalRules.map(r =>
        r.source === 'preset-range' &&
        r.tag === tag &&
        r.op === (bound === 'min' ? '<' : '>')
          ? { ...r, value }
          : r,
      ),
    )
  // Back to each bound's recorded preset value; a rule with none is left as is.
  const resetPreset = (tag: string) =>
    onConditionalChange(
      conditionalRules.map(r =>
        r.source === 'preset-range' &&
        r.tag === tag &&
        typeof r.presetRange?.original === 'number'
          ? { ...r, value: r.presetRange.original }
          : r,
      ),
    )
  const removePreset = (tag: string) =>
    onConditionalChange(
      conditionalRules.filter(
        r => !(r.source === 'preset-range' && r.tag === tag),
      ),
    )
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
  // A rule that stops being clippable (Range turned on, `==`/`!=` picked)
  // while set to Clip falls back to Exclude here, so Clip can never be left
  // on a rule `precleanse` would silently ignore it for.
  const updateConditional = (id: string, patch: Partial<ConditionalRule>) =>
    onConditionalChange(
      conditionalRules.map(r => {
        if (r.id !== id) return r
        const next = { ...r, ...patch }
        return next.action === 'clip' && !conditionalRuleCanClip(next)
          ? { ...next, action: 'mark' }
          : next
      }),
    )
  // DS-LAKE-032-D09. Turning range on adds an empty lower bound and pulls the
  // right-hand op into `<`/`<=` so the rule reads as an interval; turning it
  // off DELETES `lower` (not `undefined`) so the rule is exactly a legacy one.
  const toggleRange = (rule: ConditionalRule) => {
    if (rule.lower) {
      const { lower: _lower, ...rest } = rule
      void _lower
      onConditionalChange(
        conditionalRules.map(r => (r.id === rule.id ? rest : r)),
      )
      return
    }
    updateConditional(rule.id, {
      lower: { value: '', op: '<=' },
      op: (RANGE_OPS as readonly CutoffOp[]).includes(rule.op) ? rule.op : '<',
    })
  }
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
              <span className="font-mono">Value &gt; 1000</span>), or turn on
              Range for an interval (e.g.{' '}
              <span className="font-mono">200 &lt;= Value &lt; 500</span>).
            </p>
          )}
          {presetGroups.map(({ tag, rules }) => (
            <PresetRangeRuleRow
              key={`preset-range-${tag}`}
              tag={tag}
              rules={rules}
              unit={tagUnits[tag] ?? null}
              onBoundChange={setPresetBound}
              onActionChange={setPresetAction}
              onReset={resetPreset}
              onRemove={removePreset}
            />
          ))}
          {handRules.map(rule => (
            <div
              key={rule.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2',
                !rule.enabled && 'opacity-60',
              )}
            >
              {rule.lower && (
                <>
                  <Input
                    type="number"
                    step="any"
                    placeholder="Low"
                    aria-label="Range lower value"
                    value={rule.lower.value}
                    onChange={e =>
                      updateConditional(rule.id, {
                        lower: {
                          op: rule.lower!.op,
                          value:
                            e.target.value === ''
                              ? ''
                              : parseFloat(e.target.value),
                        },
                      })
                    }
                    className="h-7 w-24 font-mono text-xs"
                  />
                  <Select
                    value={rule.lower.op}
                    onValueChange={v =>
                      updateConditional(rule.id, {
                        lower: { value: rule.lower!.value, op: v as RangeOp },
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label="Range lower operator"
                      className="h-7 w-16 font-mono text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RANGE_OPS.map(op => (
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
                </>
              )}
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
                  {(rule.lower ? RANGE_OPS : OPS).map(op => (
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
                placeholder={rule.lower ? 'High' : 'Value'}
                value={rule.value}
                onChange={e =>
                  updateConditional(rule.id, {
                    value:
                      e.target.value === '' ? '' : parseFloat(e.target.value),
                  })
                }
                className="h-7 w-24 font-mono text-xs"
              />
              {/* DS-LAKE-032-D09: hand-authored rules only. A preset row's
                  meaning is read back as a single op/value by `activeBounds`
                  and by the SD&TA in-sync signature, so a lower bound there
                  would change what the rule cuts without either noticing. */}
              {!rule.source && (
                <Button
                  type="button"
                  variant={rule.lower ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={Boolean(rule.lower)}
                  title={
                    rule.lower
                      ? 'Back to a single comparison'
                      : 'Make this a range, e.g. 200 <= tag < 500'
                  }
                  onClick={() => toggleRange(rule)}
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  <MoveHorizontal className="h-3.5 w-3.5" />
                  Range
                </Button>
              )}
              {/* SD&TA conditions keep their own toggle (they drop whole
                  shutdown rows). Every condition the user writes gets the
                  cleaning toolkit's Clip | Exclude, like the preset ranges:
                  Clip clamps a matched reading to the rule's value, Exclude
                  marks it Bad and keeps it. Clip is offered only where there
                  is a single bound to clamp to. */}
              {rule.source === 'sdta' ? (
                <ActionToggle
                  value={rule.action === 'clip' ? 'mark' : rule.action}
                  onChange={a => updateConditional(rule.id, { action: a })}
                />
              ) : (
                <SegmentedToggle<RangeAction>
                  ariaLabel="What to do with matching readings"
                  value={rangeActionOf(rule)}
                  onChange={a =>
                    updateConditional(rule.id, { action: toRuleAction(a) })
                  }
                  options={
                    conditionalRuleCanClip(rule)
                      ? RANGE_ACTION_OPTIONS
                      : RANGE_ACTION_OPTIONS.filter(o => o.value === 'exclude')
                  }
                />
              )}
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
