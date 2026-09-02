'use client'

import { useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DateTimePicker, toDateTimeLocal } from '@/components/date-time-picker'
import { describeHoldoutSelection } from '@/lib/holdout'
import { resolveInterval } from '@/lib/dataset-fetch'
import {
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwHoldoutRangeAtom,
  dwRawDatasetAtom,
  dwTargetTagAtom,
  dwTimeRangeAtom,
  type FeatureWarmState,
} from '@/store/dataset-studio'
import type { CustomDateRange } from '@/store/data-visualize'
import type { Dataset } from '@/lib/preprocessing'

/**
 * The raw fetched window, derived from the ACTUAL frame (`dwRawDatasetAtom`),
 * not the requested `dwCustomDateRangeAtom` — the latter can be null (a
 * preset-period fetch never writes it) and is always available here since
 * the raw dataset already exists by the time Step 3.1 mounts. Rows are
 * sorted ascending by timestamp (`mergeDataset`, lib/dataset-fetch.ts), so
 * the first/last row are the true bounds. Round-tripped through `Date` so
 * whatever timestamp string shape the source produced normalises to the
 * same "YYYY-MM-DDTHH:MM" `DateTimePicker` expects.
 */
function deriveRawWindow(raw: Dataset): CustomDateRange | null {
  const first = raw.rows[0]
  const last = raw.rows[raw.rows.length - 1]
  if (!first || !last) return null
  return {
    from: toDateTimeLocal(new Date(first.timestamp)),
    to: toDateTimeLocal(new Date(last.timestamp)),
  }
}

/**
 * DS-LAKE-018-T06, relocated by DS-LAKE-023-T06 — Step 2 to Step 3.1 (see
 * the original move's own reasoning below) to Step 4: the user picks a
 * holdout after seeing not just their raw data but the FEATURES they
 * authored on it, which is what makes the holdout feature-bearing.
 *
 * Owns its own atom read/write, same convention as before the move: no
 * drag-selection state exists to keep in sync with, unlike
 * `CropTimeInputs`. Also owns the fetch-window and interval derivation that
 * used to be Step 2 local state (`customFrom`/`customTo`/
 * `effectiveInterval`) — gone by the time this component mounts, so it
 * reads the same underlying atoms directly instead.
 *
 * Committing is behind an explicit Apply button, not the date inputs:
 * auto-committing on each date change made editing Start-then-End fire two
 * commits, the first against a window the user never chose.
 *
 * DS-LAKE-023 (edit-mode re-split pass) REMOVED the `resplit` callback this
 * component used to receive and call — there is no longer a second
 * server-side trigger to fire alongside the atom write. Both modes now go
 * through the SAME path: `setHoldoutRange` below writes
 * `dwHoldoutRangeAtom`, and the parent's `useDatasetGoldWarm` effect
 * (already debounced, already re-fired on every feature-recipe edit) has
 * `holdoutRange` as a dependency, so the write alone is enough to schedule
 * the next features-job call in either mode. What this component still
 * receives from the parent is READ-ONLY status: `status`/`error` mirror
 * that SAME warm's own `dwFeatureWarmStateAtom`/`dwGoldWarmErrorAtom`, so
 * the existing "Applying…" rendering below needed no changes beyond the
 * prop names — it was always driven by an external pending flag, just a
 * differently-sourced one before this pass.
 *
 * `featureBearing` selects which of `describeHoldoutSelection`'s two guard
 * behaviours applies — see that function's own doc comment.
 */
export function ValidationHoldoutSection({
  disabled,
  disabledReason,
  featureBearing = false,
  status: warmStatus,
  error: warmError,
}: {
  disabled: boolean
  /**
   * DS-LAKE-024-T04. One sentence naming WHY the picker is disabled — shown
   * only while `disabled` is also true. Not a full explanatory panel: the
   * one live reason today (an already-split edit-mode root) has exactly one
   * remedy (re-fetch), so one line covers it.
   */
  disabledReason?: string
  featureBearing?: boolean
  status: FeatureWarmState
  error: string | null
}) {
  const [holdoutRange, setHoldoutRange] = useAtom(dwHoldoutRangeAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)
  const raw = useAtomValue(dwRawDatasetAtom)
  const fetchConfig = useAtomValue(dwFetchConfigAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const period = useAtomValue(dwTimeRangeAtom)

  const rawWindow = deriveRawWindow(raw)
  const fetchFrom = rawWindow?.from ?? ''
  const fetchTo = rawWindow?.to ?? ''
  const interval =
    fetchConfig.summaryDuration.trim() ||
    resolveInterval(period, customInterval)

  const [enabled, setEnabled] = useState(holdoutRange !== null)
  const [draftFrom, setDraftFrom] = useState(holdoutRange?.from ?? '')
  const [draftTo, setDraftTo] = useState(holdoutRange?.to ?? '')

  // Re-sync whenever the atom changes elsewhere (wizard reset, edit-mode
  // hydration) — not just on mount, or a reset would leave this section
  // showing a stale draft the atom no longer holds. This effect only
  // syncs LOCAL draft state from the atom; it never writes the atom back,
  // so hydration/reset cannot itself schedule the parent's warm — only
  // `applyHoldout`/`handleToggle` (real user actions) do that.
  useEffect(() => {
    setEnabled(holdoutRange !== null)
    setDraftFrom(holdoutRange?.from ?? '')
    setDraftTo(holdoutRange?.to ?? '')
  }, [holdoutRange])

  const guard = describeHoldoutSelection({
    fetchRange: { from: fetchFrom, to: fetchTo },
    holdoutRange:
      draftFrom && draftTo ? { from: draftFrom, to: draftTo } : null,
    interval,
    targetChosen: targetTag !== null,
    featureBearing,
  })

  // Commits only a VALID selection — a refusal is shown inline but never
  // written to the atom, so a mid-edit typo can't silently discard an
  // otherwise-good holdout that was already saved there.
  //
  // Behind an explicit Apply rather than firing on each date change: the
  // atom write below schedules the parent's debounced warm, and editing
  // Start then End auto-committed TWICE without this gate — the first time
  // against a window pairing the new Start with the OLD End, which the
  // user never asked for and which is often valid enough to pass the guard
  // and be scheduled.
  const applyHoldout = () => {
    if (!draftFrom || !draftTo) return
    const result = describeHoldoutSelection({
      fetchRange: { from: fetchFrom, to: fetchTo },
      holdoutRange: { from: draftFrom, to: draftTo },
      interval,
      targetChosen: targetTag !== null,
      featureBearing,
    })
    if (result.refusals.length === 0) {
      setHoldoutRange({ from: draftFrom, to: draftTo })
    }
  }

  const handleToggle = (next: boolean) => {
    setEnabled(next)
    if (!next) {
      setHoldoutRange(null)
      setDraftFrom('')
      setDraftTo('')
    }
  }

  const warmPending = warmStatus === 'pending'

  // Both halves chosen, the guard content, and actually different from what is
  // already committed — re-applying an unchanged window would re-split the
  // dataset for no change at all.
  const dirty =
    draftFrom !== (holdoutRange?.from ?? '') ||
    draftTo !== (holdoutRange?.to ?? '')
  const canApply =
    !disabled &&
    !warmPending &&
    Boolean(draftFrom && draftTo) &&
    guard.refusals.length === 0 &&
    dirty

  return (
    <div className="mt-1 space-y-2 border-t border-border/60 pt-3">
      <label className="flex items-center gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={disabled || warmPending}
          aria-label={
            enabled ? 'Remove validation holdout' : 'Add validation holdout'
          }
        />
        <span className="text-sm font-medium text-foreground">
          Split Validation data (optional)
        </span>
        {/* Only for the toggle-OFF path, which has no Apply button of its
            own; while the section is open the button below owns this state. */}
        {warmPending && !enabled && (
          <span className="text-[11px] text-muted-foreground">Applying…</span>
        )}
      </label>
      {disabled && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mp-holdout-from" className="text-xs">
                Start
              </Label>
              <DateTimePicker
                id="mp-holdout-from"
                value={draftFrom}
                min={fetchFrom}
                max={fetchTo}
                disabled={disabled || warmPending}
                onChange={setDraftFrom}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mp-holdout-to" className="text-xs">
                End
              </Label>
              <DateTimePicker
                id="mp-holdout-to"
                value={draftTo}
                min={fetchFrom}
                max={fetchTo}
                disabled={disabled || warmPending}
                onChange={setDraftTo}
              />
            </div>
          </div>
          {guard.refusals.map(msg => (
            <p key={msg} className="text-[11px] text-destructive">
              {msg}
            </p>
          ))}
          {guard.warnings.map(msg => (
            <p key={msg} className="text-[11px] text-muted-foreground">
              {msg}
            </p>
          ))}
          {warmError && (
            <p className="text-[11px] text-destructive">{warmError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {dirty && guard.refusals.length === 0 && !warmPending && (
              // Says why the button is lit. Without it a user who edited a
              // date and walked away has no signal that the split on the
              // server is still the previous one.
              <span className="text-[11px] text-muted-foreground">
                Not applied yet
              </span>
            )}
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!canApply}
              onClick={applyHoldout}
            >
              {warmPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Apply Split
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
