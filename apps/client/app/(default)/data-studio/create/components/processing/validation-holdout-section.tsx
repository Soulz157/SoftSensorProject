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
} from '@/store/dataset-studio'
import type { CustomDateRange } from '@/store/data-visualize'
import type { Dataset } from '@/lib/preprocessing'
import type { UseDatasetHoldoutResplitResult } from '@/hooks/dataset/use-dataset-holdout-resplit'

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
 * DS-LAKE-018-T06. Moved here from Step 2 — the user now sees their data
 * (Step 3.1's charts) before picking a holdout, rather than choosing a
 * validation window against a time range they only know abstractly.
 *
 * Owns its own atom read/write, same convention as before the move: no
 * drag-selection state exists to keep in sync with, unlike
 * `CropTimeInputs`. Now ALSO owns the fetch-window and interval derivation
 * that used to be Step 2 local state (`customFrom`/`customTo`/
 * `effectiveInterval`) — those are gone by the time this component mounts
 * at Step 3.1, so it reads the same underlying atoms directly instead.
 *
 * Committing is behind an explicit Apply button, not the date inputs: a
 * commit re-splits the draft's BRONZE server-side, so auto-committing made
 * editing Start-then-End fire two re-splits, the first against a window the
 * user never chose.
 *
 * A commit here does not merely update `dwHoldoutRangeAtom` (which
 * `useDatasetBronzeWarm` only reads at MATERIALIZE time, already past by
 * Step 3.1) — it also fires `resplit` (from `useDatasetHoldoutResplit`,
 * called by the PARENT — `Step31EDA` needs the same pending status to gate
 * its Next button, so the hook is lifted rather than owned here), which
 * re-splits the draft's existing pristine BRONZE server-side. See that
 * hook's own doc comment for why re-splitting from pristine (not the
 * current artifact) is the only lossless way to do this.
 */
export function ValidationHoldoutSection({
  disabled,
  status: resplitStatus,
  error: resplitError,
  resplit,
}: {
  disabled: boolean
} & UseDatasetHoldoutResplitResult) {
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
  // showing a stale draft the atom no longer holds. Deliberately does NOT
  // call `resplit` — hydration/reset are not a user-initiated change, and
  // re-splitting here would fire on every navigation back to this step.
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
  })

  // Commits only a VALID selection — a refusal is shown inline but never
  // written to the atom, so a mid-edit typo can't silently discard an
  // otherwise-good holdout that was already saved there. This is the ONE
  // place this component calls `resplit` — the actual user action that must
  // reach the server.
  //
  // Behind an explicit Apply rather than firing on each date change: a commit
  // re-splits the draft's pristine BRONZE server-side, and editing Start then
  // End auto-committed TWICE — the first time against a window pairing the new
  // Start with the OLD End, which the user never asked for and which is often
  // valid enough to pass the guard and be persisted.
  const applyHoldout = () => {
    if (!draftFrom || !draftTo) return
    const result = describeHoldoutSelection({
      fetchRange: { from: fetchFrom, to: fetchTo },
      holdoutRange: { from: draftFrom, to: draftTo },
      interval,
      targetChosen: targetTag !== null,
    })
    if (result.refusals.length === 0) {
      setHoldoutRange({ from: draftFrom, to: draftTo })
      void resplit({ from: draftFrom, to: draftTo })
    }
  }

  const handleToggle = (next: boolean) => {
    setEnabled(next)
    if (!next) {
      setHoldoutRange(null)
      setDraftFrom('')
      setDraftTo('')
      void resplit(null)
    }
  }

  const resplitPending = resplitStatus === 'pending'

  // Both halves chosen, the guard content, and actually different from what is
  // already committed — re-applying an unchanged window would re-split the
  // dataset for no change at all.
  const dirty =
    draftFrom !== (holdoutRange?.from ?? '') ||
    draftTo !== (holdoutRange?.to ?? '')
  const canApply =
    !disabled &&
    !resplitPending &&
    Boolean(draftFrom && draftTo) &&
    guard.refusals.length === 0 &&
    dirty

  return (
    <div className="mt-1 space-y-2 border-t border-border/60 pt-3">
      <label className="flex items-center gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={disabled || resplitPending}
          aria-label={
            enabled ? 'Remove validation holdout' : 'Add validation holdout'
          }
        />
        <span className="text-sm font-medium text-foreground">
          Split Validation data (optional)
        </span>
        {/* Only for the toggle-OFF re-split, which has no Apply button of its
            own; while the section is open the button below owns this state. */}
        {resplitPending && !enabled && (
          <span className="text-[11px] text-muted-foreground">Applying…</span>
        )}
      </label>
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
                disabled={disabled || resplitPending}
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
                disabled={disabled || resplitPending}
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
          {resplitError && (
            <p className="text-[11px] text-destructive">{resplitError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            {dirty && guard.refusals.length === 0 && !resplitPending && (
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
              {resplitPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Applying…
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Apply
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
