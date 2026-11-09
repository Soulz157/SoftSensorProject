'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  Ban,
  Info,
  Pencil,
  RotateCcw,
  Scissors,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SegmentedToggle } from '@/components/segmented-toggle'
import {
  suggestRangeAction,
  type RangeActionSuggestion,
} from '@/lib/critical-tags'
import type { Dataset } from '@/lib/preprocessing'
import type { ConditionalAction, ConditionalRule } from '@/lib/precleanse'
import { cn } from '@/lib/utils'
import {
  describeRangeCutoffSelection,
  formatKeptWindow,
  presetRangeBounds,
  presetRangeWindow,
  rangeActionOf,
  reconcileRangeUnit,
  toRuleAction,
  type RangeAction,
} from '@/lib/range-cutoff'
import type { PresetRangeCandidate } from '@/store/dataset-studio'

// ---------------------------------------------------------------------------
// Preset range cutoff (DS-LAKE-020-T05, moved to its own card by DS-LAKE-038)
// ---------------------------------------------------------------------------

const PRESET_RANGE_PREFIX = 'preset-range'

/**
 * `TAG │ 30 ≤ x ≤ 100 kg/h` - the one format a preset range is shown in, here
 * and in the Outlier Removal panel's Conditional tab. A fragment of three
 * cells so it drops into this card's grid (tag, divider and window line up
 * across rows) and into a flex row alike. The divider is a drawn hairline,
 * not a typed "|": crisper, and hidden from screen readers, which read
 * "TAG, 30 ≤ x ≤ 100 kg/h".
 */
/** The hairline between a tag and its window. */
export function RangeDivider() {
  return (
    <span
      aria-hidden
      className="h-4 w-px shrink-0 justify-self-center bg-border"
    />
  )
}

export function PresetRangeLabel({
  tag,
  window,
  suffix,
}: {
  tag: string
  window: string
  /** Shown after the window, e.g. the "Edited" badge. */
  suffix?: ReactNode
}) {
  return (
    <>
      <span className="truncate">{tag}</span>
      <RangeDivider />
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{window}</span>
        {suffix}
      </span>
    </>
  )
}

/**
 * Same names and icons as the cleaning toolkit's Clip Bounds and Exclude Range
 * (imputation-detail-panel.tsx), so the two read as one vocabulary.
 */
export const RANGE_ACTION_OPTIONS = [
  {
    value: 'clip' as const,
    label: 'Clip',
    icon: <Scissors className="h-3.5 w-3.5" />,
  },
  {
    value: 'exclude' as const,
    label: 'Exclude',
    icon: <Ban className="h-3.5 w-3.5" />,
  },
]

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
 * The ConditionalRule(s) a candidate's reconciled bound adds. Strict `<`/`>`
 * so a value exactly ON the bound stays untouched, matching the closed-range
 * grammar `[min, max]`. Empty when the unit gate refuses (`applied === null`):
 * never a rule with a guessed number.
 *
 * Rule ids are keyed by TAG ONLY, not by candidate - enabling one candidate
 * for a tag structurally replaces any other candidate's rule for the same
 * tag, which is what makes the duplicate-row case (DS-LAKE-020-T08) resolve to
 * "engineer picks" with no separate picker UI.
 *
 * `action` is what happens to a reading outside the range: `clip` clamps it to
 * the bound, `drop` turns it into a hole (DS-LAKE-038).
 */
function presetRangeRules(
  candidate: PresetRangeCandidate,
  applied: { min: number | null; max: number | null },
  quotedUnit: string | null,
  action: ConditionalAction,
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
      action,
      enabled: true,
      source: 'preset-range',
      presetRange: { ...provenance, original: applied.min },
    })
  }
  if (applied.max !== null) {
    rules.push({
      id: presetRangeRuleId(candidate.tag, 'max'),
      tag: candidate.tag,
      op: '>',
      value: applied.max,
      action,
      enabled: true,
      source: 'preset-range',
      presetRange: { ...provenance, original: applied.max },
    })
  }
  return rules
}

/**
 * What an enabled row currently does. A pair whose two bounds were given
 * different actions in the Conditional tab is `mixed`; the legacy `mark`
 * action (rules saved before Clip existed) reads as `drop`.
 */
function rowAction(rules: ConditionalRule[]): RangeAction | 'mixed' | null {
  if (rules.length === 0) return null
  const actions = new Set<RangeAction>(rules.map(rangeActionOf))
  if (actions.size > 1) return 'mixed'
  return actions.has('clip') ? 'clip' : 'exclude'
}

function suggestedLabel(action: RangeAction): string {
  return action === 'clip' ? 'Clip' : 'Exclude'
}

/**
 * One tag's preset-range proposal. Toggling reads/writes `conditionalRules`
 * directly - there is no separate "applied" state to keep in sync, so a rule
 * deleted by hand in the Conditional tab correctly reads back here as off.
 */
function PresetRangeRow({
  candidate,
  tagUnit,
  conditionalRules,
  onConditionalChange,
  suggestion,
  editMode,
}: {
  candidate: PresetRangeCandidate
  tagUnit: string | null
  conditionalRules: ConditionalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  /** Clip for a critical tag, Exclude otherwise (lib/critical-tags.ts). */
  suggestion: RangeActionSuggestion
  editMode: boolean
}) {
  const reconciliation = useMemo(
    () => reconcileRangeUnit(candidate.parsed, tagUnit),
    [candidate.parsed, tagUnit],
  )
  const tagRules = conditionalRules.filter(r =>
    isPresetRangeRuleForTag(r, candidate.tag),
  )
  const isActive =
    tagRules.length > 0 &&
    tagRules[0]?.presetRange?.quoted === candidate.quotedRange
  // The choice made before the row is enabled; once enabled, the rules ARE the
  // state and this is ignored. `null` = untouched, so the row follows the
  // suggestion (a tag starred in Step 1 later flips it) until the engineer
  // picks an action themselves - an explicit pick is never overwritten.
  const [pickedAction, setPickedAction] = useState<RangeAction | null>(null)
  const pendingAction = pickedAction ?? suggestion.action
  const currentAction = isActive ? rowAction(tagRules) : pendingAction
  const offSuggestion =
    isActive &&
    currentAction !== null &&
    currentAction !== 'mixed' &&
    currentAction !== suggestion.action

  const withoutThisTag = () =>
    conditionalRules.filter(r => !isPresetRangeRuleForTag(r, candidate.tag))

  const enable = (checked: boolean) => {
    if (!checked || !reconciliation.applied) {
      onConditionalChange(withoutThisTag())
      return
    }
    onConditionalChange([
      ...withoutThisTag(),
      ...presetRangeRules(
        candidate,
        reconciliation.applied,
        reconciliation.quotedUnit,
        toRuleAction(pendingAction),
      ),
    ])
  }

  // Changing the action keeps the CURRENT bounds - rebuilding from the preset
  // would silently undo an edit made in the Outlier Removal panel.
  const chooseAction = (next: RangeAction) => {
    setPickedAction(next)
    if (!isActive) return
    onConditionalChange(
      conditionalRules.map(r =>
        isPresetRangeRuleForTag(r, candidate.tag)
          ? { ...r, action: toRuleAction(next) }
          : r,
      ),
    )
  }

  // Back to the preset's own numbers, keeping the chosen action.
  const resetToPreset = () => {
    if (!reconciliation.applied) return
    const keep = toRuleAction(currentAction === 'exclude' ? 'exclude' : 'clip')
    onConditionalChange([
      ...withoutThisTag(),
      ...presetRangeRules(
        candidate,
        reconciliation.applied,
        reconciliation.quotedUnit,
        keep,
      ),
    ])
  }

  const refused =
    reconciliation.verdict === 'unknown-unit' ||
    reconciliation.verdict === 'tag-unit-unknown'
  const openEnded =
    candidate.parsed.kind === 'lower' || candidate.parsed.kind === 'upper'
  const unit = tagUnit ?? reconciliation.quotedUnit
  const inputId = `preset-range-${candidate.tag}`

  // What the row SHOWS: the rules' current bounds once enabled (so an edit made
  // in the Outlier Removal panel is visible here), the preset's otherwise.
  const presetWindow = reconciliation.applied
  const shownWindow = isActive ? presetRangeWindow(tagRules) : presetWindow
  const edited = Boolean(
    isActive &&
    presetWindow &&
    shownWindow &&
    (shownWindow.min !== presetWindow.min ||
      shownWindow.max !== presetWindow.max),
  )

  // Provenance and the quoted text are reference, not decision input - they
  // live in the tooltip (progressive disclosure) so each row stays one line.
  const provenance = [
    `Quoted: ${candidate.quotedRange}`,
    reconciliation.verdict === 'converted' && reconciliation.factor !== null
      ? `Converted ×${reconciliation.factor} to ${tagUnit}`
      : null,
    `${candidate.presetId} · config ${candidate.configNo} · ${candidate.sheet}`,
  ]
    .filter(Boolean)
    .join('\n')

  const refusedReason =
    reconciliation.verdict === 'tag-unit-unknown'
      ? `Preset quotes this range in "${reconciliation.quotedUnit}", but no unit is recorded for this tag — a kg/hr bound and a t/h bound are indistinguishable here, so the quoted number is not applied.`
      : `No known conversion from preset unit "${reconciliation.quotedUnit}" to tag unit "${reconciliation.tagUnit}" — refusing to apply.`

  return (
    <li
      className={cn(
        // One shared grid across rows (Law of Similarity): checkbox, tag and
        // window line up in columns, so the eye scans down, not across.
        'grid grid-cols-[auto_minmax(0,9rem)_auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-xs transition-colors',
        isActive ? 'bg-primary/5' : 'bg-background',
      )}
    >
      <Checkbox
        id={inputId}
        checked={isActive}
        onCheckedChange={checked => enable(checked === true)}
        disabled={refused}
        aria-label={`Toggle preset range cutoff for ${candidate.tag}`}
      />
      {/* Tag + window are ONE label: the biggest target on the row toggles it
          (Fitts's Law), not just the 16px box. */}
      <label
        htmlFor={inputId}
        title={provenance}
        className={cn(
          'col-span-3 grid min-h-9 grid-cols-subgrid items-center font-mono',
          refused ? 'cursor-not-allowed' : 'cursor-pointer',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <PresetRangeLabel
          tag={candidate.tag}
          window={
            shownWindow
              ? formatKeptWindow(shownWindow, unit)
              : candidate.quotedRange
          }
          suffix={
            edited ? (
              <Badge variant="outline" className="gap-1">
                <Pencil className="size-3" />
                Edited
              </Badge>
            ) : null
          }
        />
      </label>
      {/* The suggestion sits beside the toggle it is about; the reason is in
          the tooltip so the row stays one line. A button so the keyboard can
          reach it. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Suggested for ${candidate.tag}: ${suggestedLabel(suggestion.action)}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Info className="h-3 w-3" />
            Suggested: {suggestedLabel(suggestion.action)}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          <p>{suggestion.reason}</p>
          <p className="mt-1 opacity-80">
            {editMode
              ? 'Critical tags are marked with the star in Step 1, which is locked while editing a saved dataset.'
              : 'Mark critical tags with the star in Step 1.'}
          </p>
        </TooltipContent>
      </Tooltip>
      {/* `mixed` is a state to SHOW (neither segment lit), never one to pick,
          so it is in the value type but not in the options. */}
      <SegmentedToggle<RangeAction | 'mixed'>
        ariaLabel={`What to do with ${candidate.tag} readings outside the range`}
        value={currentAction ?? 'clip'}
        onChange={next => {
          if (next !== 'mixed') chooseAction(next)
        }}
        options={RANGE_ACTION_OPTIONS}
      />
      {(refused || openEnded || currentAction === 'mixed') && (
        <p
          className="col-span-5 col-start-2 flex items-center gap-1 pb-1 text-[11px] text-muted-foreground"
          title={refused ? refusedReason : undefined}
        >
          <TriangleAlert className="h-3 w-3 shrink-0" />
          {refused
            ? `Unit mismatch (${reconciliation.quotedUnit ?? '—'} → ${reconciliation.tagUnit ?? 'no unit'}) — not applied`
            : currentAction === 'mixed'
              ? 'Bounds have different actions — pick one to apply to both'
              : 'Operating window, not a validity range — confirm before enabling'}
        </p>
      )}
      {/* Neutral, not a warning colour: going against the suggestion is a
          legitimate engineering call, the note only says what it costs. */}
      {offSuggestion && (
        <p className="col-span-5 col-start-2 flex items-center gap-1 pb-1 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          {suggestion.action === 'clip'
            ? 'Critical tag set to Exclude: out-of-range readings become holes, which can cost rows this input needs.'
            : 'Clip on a non-critical tag: bad readings are pinned to the bound instead of being imputed.'}
        </p>
      )}
      {/* Says WHERE the numbers changed and what the preset said, so an edit
          made further down the step is never a surprise here. */}
      {edited && presetWindow && (
        <p className="col-span-5 col-start-2 flex items-center gap-1 pb-1 text-[11px] text-muted-foreground">
          <Pencil className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">
            Edited in Outlier Removal · preset was{' '}
            <span className="font-mono">
              {formatKeptWindow(presetWindow, unit)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToPreset}
            className="ml-1 h-6 gap-1 px-1.5 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </p>
      )}
    </li>
  )
}

interface Props {
  /** DS-LAKE-020: proposed range cutoffs from the applied feature preset. */
  candidates: PresetRangeCandidate[]
  /** True when the applied preset predates range-cutoff support. */
  stale: boolean
  /** Tags in the frame being cleaned. */
  tags: string[]
  /** The isolated tag, listed first. */
  scopeTag: string | undefined
  tagUnits: Record<string, string | null>
  /** The frame the cutoffs would apply against (after the time crop). */
  previewDataset: Dataset
  conditionalRules: ConditionalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  /** Null until Step 4 - the labelled-row guard cannot run without it. */
  targetTag: string | null
  /**
   * Tags starred critical in Step 1. Each row suggests - and, until the
   * engineer picks, defaults to - Clip for these and Exclude for the rest.
   */
  criticalTags?: string[]
  /**
   * Edit mode. Its per-batch server sync (`use-dataset-draft-pipeline.ts`) is
   * scoped to the batch's tags and sends no range operations, so the choice is
   * previewed and kept in the recipe but not written to the stored rows by an
   * edit-mode save. Said on the card rather than discovered afterwards.
   */
  editMode?: boolean
}

/**
 * Preset range cutoff, as its own card under the SD&TA preset card
 * (DS-LAKE-038). It used to sit inside the Outlier Removal sidebar - four
 * levels down and visible only once cleaning tags were chosen.
 *
 * Each row reads as the window it KEEPS (`30 ≤ x ≤ 100 kg/h`) and carries what
 * happens to a reading outside it:
 *   Clip - clamp to the bound; the row and its Good status survive.
 *   Drop - the reading becomes a hole, which later steps impute or a
 *          Drop-missing step removes.
 * Neither is the destructive/status colour: the toggle is the neutral
 * `SegmentedToggle` the SD&TA card already uses for And/OR.
 */
export function PresetRangeCard({
  candidates,
  stale,
  tags,
  scopeTag,
  tagUnits,
  previewDataset,
  conditionalRules,
  onConditionalChange,
  targetTag,
  criticalTags = [],
  editMode = false,
}: Props) {
  // Every candidate for a tag in the frame, the isolated tag's first.
  const relevant = useMemo(
    () =>
      candidates
        .filter(c => tags.includes(c.tag))
        .sort(
          (a, b) => Number(b.tag === scopeTag) - Number(a.tag === scopeTag),
        ),
    [candidates, tags, scopeTag],
  )

  const bounds = useMemo(
    () => presetRangeBounds(conditionalRules),
    [conditionalRules],
  )

  // Remaining-row / remaining-labelled-row guards, fired while the toggles are
  // being flipped - cheap to change here, unlike at Save or at training.
  const guard = useMemo(
    () =>
      describeRangeCutoffSelection({
        dataset: previewDataset,
        activeBounds: bounds,
        targetTag,
      }),
    [previewDataset, bounds, targetTag],
  )

  if (relevant.length === 0) {
    // A stale (pre-range-cutoff) preset genuinely has no `range_parsed` on any
    // feature, so `candidates` is empty for a reason the engineer has no other
    // way to see - say so, rather than rendering nothing.
    if (!stale) return null
    return (
      <div className="space-y-1 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          Preset range cutoff
        </h3>
        <p className="text-xs text-muted-foreground">
          This preset was imported before range-cutoff support existed, so it
          carries no parsed ranges. Re-import the same Excel workbook from Step
          1 to enable per-tag range proposals here.
        </p>
      </div>
    )
  }

  const enabled = relevant.filter(c =>
    conditionalRules.some(
      r =>
        r.enabled &&
        r.tag === c.tag &&
        r.source === 'preset-range' &&
        r.presetRange?.quoted === c.quotedRange,
    ),
  ).length

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        {/* Same header shape as the SD&TA card above (Jakob's Law); the count
          sits next to the title it qualifies (Law of Proximity). */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground">
              Imported Presets · Range
            </span>
            <h3 className="text-sm font-semibold text-foreground">
              Preset range cutoff
            </h3>
            <p className="text-xs text-muted-foreground">
              From the preset&apos;s Range column. Off until you enable a row.
              Suggests Clip for critical tags, Exclude for the rest.
            </p>
          </div>
          <span className="shrink-0 pt-4 font-mono text-xs text-muted-foreground">
            {enabled} of {relevant.length} enabled
          </span>
        </div>
        {editMode && (
          <p className="text-[11px] text-muted-foreground">
            Editing a saved dataset: range cutoffs are previewed and kept in the
            recipe, but saving an edit does not apply them to the stored rows
            yet.
          </p>
        )}
        <ul className="space-y-1">
          {relevant.map(candidate => (
            <PresetRangeRow
              key={`${candidate.presetId}:${candidate.rowLabel}`}
              candidate={candidate}
              tagUnit={tagUnits[candidate.tag] ?? null}
              conditionalRules={conditionalRules}
              onConditionalChange={onConditionalChange}
              suggestion={suggestRangeAction(candidate.tag, criticalTags)}
              editMode={editMode}
            />
          ))}
        </ul>
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
    </TooltipProvider>
  )
}
