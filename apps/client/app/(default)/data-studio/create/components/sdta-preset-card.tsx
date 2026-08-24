'use client'

import { useMemo, useState } from 'react'
import {
  CalendarX2,
  Check,
  Filter,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  planSdtaSelection,
  presetCutSignature,
  replacePresetExclusions,
  replacePresetRules,
  type SdtaCombine,
  type SdtaPreset,
  type TagHealth,
} from '@/lib/feature-preset-apply'
import type { ConditionalRule, RangeExclusion } from '@/lib/precleanse'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'

interface Props {
  presets: SdtaPreset[]
  health: TagHealth
  exclusions: RangeExclusion[]
  conditionalRules: ConditionalRule[]
  onExclusionsChange: (next: RangeExclusion[]) => void
  onConditionalChange: (next: ConditionalRule[]) => void
}

const UTC_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Fixed UTC so SSR and the browser agree. */
function formatWindow(from: string, to: string): string {
  const a = Date.parse(from)
  const b = Date.parse(to)
  // Show the raw value rather than "Invalid Date" — a malformed range is a
  // parser bug worth seeing, not worth hiding behind a placeholder.
  if (Number.isNaN(a) || Number.isNaN(b)) return `${from} → ${to}`
  const hours = (b - a) / 3_600_000
  const span =
    hours >= 48 ? `${(hours / 24).toFixed(1)} d` : `${hours.toFixed(1)} h`
  return `${UTC_FMT.format(a)} → ${UTC_FMT.format(b)} UTC · ${span}`
}

/**
 * Content-addressed, not `crypto.randomUUID()`-addressed: `planSdtaSelection`
 * mints a fresh id for every conditional rule on every recompute (reselecting
 * a preset, flipping combine mode), so an id-keyed opt-out set would forget
 * every uncheck the instant the plan recomputes. The window/condition VALUES
 * themselves are what the user is agreeing or disagreeing with, so keying on
 * those is also the more useful behaviour: unticking a window keeps it
 * unticked if the same window reappears after a combine-mode round trip.
 */
function windowKey(e: RangeExclusion): string {
  return `w|${e.time?.from}|${e.time?.to}`
}
function conditionKey(r: ConditionalRule): string {
  return `c|${r.tag}|${r.op}|${r.value}|${r.action}`
}

export function SdtaPresetCard({
  presets,
  health,
  exclusions,
  conditionalRules,
  onExclusionsChange,
  onConditionalChange,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [combine, setCombine] = useState<SdtaCombine>('all')
  // Per-item opt-out, on top of the preset-level selection above: a user may
  // want a preset's shutdown windows but not one specific stray condition it
  // also declares. Every resolved item starts INCLUDED — this holds the ones
  // the user has explicitly unticked, not the ones they kept.
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set())

  const plan = useMemo(
    () => planSdtaSelection(presets, selectedIds, combine, health),
    [presets, selectedIds, combine, health],
  )

  const finalExclusions = useMemo(
    () => plan.exclusions.filter(e => !excludedKeys.has(windowKey(e))),
    [plan.exclusions, excludedKeys],
  )
  const finalConditionalRules = useMemo(
    () => plan.conditionalRules.filter(r => !excludedKeys.has(conditionKey(r))),
    [plan.conditionalRules, excludedKeys],
  )
  const deselectedCount =
    plan.exclusions.length +
    plan.conditionalRules.length -
    (finalExclusions.length + finalConditionalRules.length)

  // Derived from the `source` marker, never stored: deleting a window by hand
  // in the CutoffSidebar has to un-sync this card, and a boolean in state
  // could not see it. Compared against the FINAL (post opt-out) set — that is
  // what Apply actually writes, so that is what "in sync" has to mean.
  const inSync = useMemo(
    () =>
      presetCutSignature(exclusions, conditionalRules) ===
      presetCutSignature(finalExclusions, finalConditionalRules),
    [exclusions, conditionalRules, finalExclusions, finalConditionalRules],
  )
  const anyApplied =
    exclusions.some(e => e.source === 'sdta') ||
    conditionalRules.some(r => r.source === 'sdta')

  if (presets.length === 0) return null

  const toggle = (id: string) =>
    setSelectedIds(ids =>
      ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id],
    )

  const toggleItem = (key: string) =>
    setExcludedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const apply = () => {
    onExclusionsChange(replacePresetExclusions(exclusions, finalExclusions))
    onConditionalChange(
      replacePresetRules(conditionalRules, finalConditionalRules),
    )
  }

  const removeAll = () => {
    onExclusionsChange(replacePresetExclusions(exclusions, []))
    onConditionalChange(replacePresetRules(conditionalRules, []))
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground">
            Imported Presets · SD&amp;TA
          </span>
          <h3 className="text-sm font-semibold text-foreground">
            Shutdown / turnaround cut
          </h3>
          <p className="text-xs text-muted-foreground">
            {selectedIds.length} of {presets.length} selected · resolves to{' '}
            {finalExclusions.length} window
            {finalExclusions.length === 1 ? '' : 's'},{' '}
            {finalConditionalRules.length} condition
            {finalConditionalRules.length === 1 ? '' : 's'}
            {deselectedCount > 0 && ` (${deselectedCount} deselected below)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {anyApplied && (
            <Button size="sm" variant="ghost" onClick={removeAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              Remove preset cuts
            </Button>
          )}
          <Button
            size="sm"
            onClick={apply}
            disabled={selectedIds.length === 0 || inSync}
          >
            <Check className="h-3.5 w-3.5" />
            Apply cut
          </Button>
        </div>
      </div>

      <SegmentedToggle
        ariaLabel="Combine presets"
        value={combine}
        onChange={setCombine}
        options={[
          { value: 'all', label: 'And' },
          { value: 'any', label: 'OR' },
        ]}
      />
      <p className="text-[11px] text-muted-foreground">
        {combine === 'all'
          ? 'A row must survive every selected preset. Adding a preset cuts more.'
          : 'A row survives if any one preset accepts it — only periods ALL selected presets call shutdown are cut. Adding a preset restores rows.'}
      </p>

      <ul className="space-y-1">
        {presets.map(p => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md bg-background px-2 py-1.5 text-xs"
          >
            <Checkbox
              id={`sdta-${p.id}`}
              checked={selectedIds.includes(p.id)}
              onCheckedChange={() => toggle(p.id)}
            />
            <label htmlFor={`sdta-${p.id}`} className="cursor-pointer">
              {p.name}
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                {p.config.ranges.length}w · {p.config.conditions.length}c
              </span>
            </label>
          </li>
        ))}
      </ul>

      {(plan.exclusions.length > 0 || plan.conditionalRules.length > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {/* In Any mode these are intersections — they match no single
                preset's own dates, so saying so avoids "why is this not what
                my Excel sheet says". */}
            {combine === 'any' && selectedIds.length > 1
              ? 'Resolved cut (overlap of selected presets) — untick to keep a row'
              : 'Resolved cut — untick to keep a row'}
          </p>
          {plan.exclusions.map((e, i) => {
            const key = windowKey(e)
            const checked = !excludedKeys.has(key)
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs"
              >
                <Checkbox
                  id={`sdta-window-${i}`}
                  checked={checked}
                  onCheckedChange={() => toggleItem(key)}
                />
                <label
                  htmlFor={`sdta-window-${i}`}
                  className="flex min-w-0 cursor-pointer items-center gap-2"
                >
                  <CalendarX2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span
                    className={cn(
                      'font-mono',
                      !checked && 'text-muted-foreground line-through',
                    )}
                  >
                    {formatWindow(e.time?.from ?? '', e.time?.to ?? '')}
                  </span>
                </label>
              </div>
            )
          })}
          {plan.conditionalRules.map(r => {
            const key = conditionKey(r)
            const checked = !excludedKeys.has(key)
            return (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs"
              >
                <Checkbox
                  id={`sdta-cond-${r.id}`}
                  checked={checked}
                  onCheckedChange={() => toggleItem(key)}
                />
                <label
                  htmlFor={`sdta-cond-${r.id}`}
                  className="flex min-w-0 cursor-pointer items-center gap-2"
                >
                  <Filter className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span
                    className={cn(
                      'font-mono',
                      !checked && 'text-muted-foreground line-through',
                    )}
                  >
                    drop row when {r.tag} {r.op} {r.value}
                  </span>
                </label>
              </div>
            )
          })}
        </div>
      )}

      {/* Silence here is the worst outcome: presets that never overlap cut
          nothing, which looks identical to "not applied yet". */}
      {plan.emptyIntersection && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          These {selectedIds.length} presets share no overlapping window — Any
          mode cuts nothing. Switch to All, or select one preset.
        </p>
      )}

      {(plan.droppedConditions.length > 0 || plan.droppedRanges.length > 0) && (
        <div className="flex gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">Not applied</p>
            {plan.droppedRanges.map(d => (
              <p key={`${d.from}|${d.to}|${d.reason}`} className="font-mono">
                {d.from} → {d.to} — {d.reason}
              </p>
            ))}
            {plan.droppedConditions.map(d => (
              <p
                key={`${d.tag}|${d.op}|${d.value}|${d.reason}`}
                className="font-mono"
              >
                {d.tag} {d.op} {d.value} — {d.reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
