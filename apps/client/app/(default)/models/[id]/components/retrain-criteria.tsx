'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { useLabEventCount } from '@/hooks/model/use-lab-event-count'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  evaluateRetrainCriterion,
  offerablePairs,
  retrainBuilderOperands,
  retrainCriterionFor,
  retrainCriterionKey,
  retrainCriterionLabel,
  retrainOperandLabel,
  retrainPartnersOf,
  type RetrainCriterion,
  type RetrainOperand,
} from '@/lib/acceptance-criteria'
import type { LabEventSource } from '@/lib/retrain-lab-events'

const R2_FLOOR: RetrainCriterion = { kind: 'retrain-r2-floor' }

/** The two one-click presets: new vs current RMSE (the "better" direction)
 *  and the untyped R² floor. Everything else is built below. */
function presetCriteria(): RetrainCriterion[] {
  const rmse = offerablePairs('retrain').find(
    p =>
      p.left.metric === 'rmse' &&
      p.right.metric === 'rmse' &&
      p.left.subject === 'candidate' &&
      p.right.subject === 'current',
  )
  return [...(rmse ? [retrainCriterionFor(rmse)] : []), R2_FLOOR]
}

const operandValue = (op: RetrainOperand) => `${op.metric}|${op.subject}`

/**
 * MODEL-SERVE-026-T07. The dialog's criteria block: chosen BEFORE the
 * retrain, none ticked by default, no number to type. Two presets, plus a
 * builder — [left] [< or >] [right] — whose lists come from the engine's
 * rules (only pairs that can go either way, same units, same window), so an
 * unanswerable comparison cannot be built. A criterion is a verdict the tab
 * states; it never blocks the retrain or a promote.
 */
export function RetrainCriteriaPicker({
  value,
  onChange,
  disabled,
}: {
  value: RetrainCriterion[]
  onChange: (next: RetrainCriterion[]) => void
  disabled?: boolean
}) {
  const lefts = retrainBuilderOperands()
  const [leftKey, setLeftKey] = useState(operandValue(lefts[0]!))
  const left = lefts.find(o => operandValue(o) === leftKey) ?? lefts[0]!
  const partners = retrainPartnersOf(left)
  const [rightKey, setRightKey] = useState<string | null>(null)
  const right =
    partners.find(o => operandValue(o) === rightKey) ?? partners[0] ?? null
  const [operator, setOperator] = useState<'lt' | 'gt'>('lt')

  const has = (c: RetrainCriterion) =>
    value.some(v => retrainCriterionKey(v) === retrainCriterionKey(c))
  const toggle = (c: RetrainCriterion, on: boolean) =>
    onChange(
      on
        ? [...value, c]
        : value.filter(v => retrainCriterionKey(v) !== retrainCriterionKey(c)),
    )
  const built: RetrainCriterion | null = right
    ? { kind: 'retrain-comparison', left, operator, right }
    : null
  const presets = presetCriteria()
  const custom = value.filter(v => !presets.some(p => retrainCriterionKey(p) === retrainCriterionKey(v)))

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">Acceptance criteria</p>
      {presets.map(c => {
        const label = retrainCriterionLabel(c)
        return (
          <label
            key={label}
            className="flex items-start gap-2 text-xs text-muted-foreground"
          >
            <Checkbox
              checked={has(c)}
              disabled={disabled}
              className="mt-0.5"
              onCheckedChange={on => toggle(c, on === true)}
            />
            <span>{label}</span>
          </label>
        )
      })}

      <p className="pt-1 text-xs font-medium text-foreground">Add your own</p>
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
        <Select
          value={operandValue(left)}
          onValueChange={v => {
            setLeftKey(v)
            setRightKey(null)
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Left side">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lefts.map(o => (
              <SelectItem key={operandValue(o)} value={operandValue(o)}>
                {retrainOperandLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={operator}
          onValueChange={v => setOperator(v === 'gt' ? 'gt' : 'lt')}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-14 text-xs" aria-label="Comparison">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lt">&lt;</SelectItem>
            <SelectItem value="gt">&gt;</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={right ? operandValue(right) : ''}
          onValueChange={setRightKey}
          disabled={disabled || partners.length === 0}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Right side">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {partners.map(o => (
              <SelectItem key={operandValue(o)} value={operandValue(o)}>
                {retrainOperandLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={disabled || !built || has(built)}
          onClick={() => built && toggle(built, true)}
        >
          Add
        </Button>
      </div>
      {custom.map(c => (
        <div
          key={retrainCriterionKey(c)}
          className="flex items-center justify-between gap-2 text-xs text-foreground"
        >
          <span>{retrainCriterionLabel(c)}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={disabled}
            onClick={() => toggle(c, false)}
          >
            Remove
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Judged at lab events on the validation window both versions are scored
        on. &ldquo;SD of lab values&rdquo; is the spread of the measured target
        there — RMSE below it means the model beats always guessing the
        average. Comparisons that could only ever come out one way (a
        version&apos;s RMSE against its own MAE or error SD) are not offered.
        The result states pass or fail with both numbers; it never stops the
        retrain or Apply to Production.
      </p>
    </div>
  )
}

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(3))

/**
 * MODEL-SERVE-026-T07. Each chosen criterion's verdict, with BOTH readings,
 * read by the same lab-event rule as the comparison grid (openDecision 2).
 * A figure that cannot be read makes the verdict "not evaluated", with why.
 */
export function RetrainCriteriaVerdicts({
  modelId,
  candidateRunId,
  criteria,
}: {
  modelId: string
  candidateRunId: string | null
  criteria: RetrainCriterion[]
}) {
  const series = (
    population: 'new_data_holdout' | 'current_new_data_holdout',
  ): LabEventSource =>
    candidateRunId
      ? { kind: 'series', runId: candidateRunId, population }
      : { kind: 'unavailable', reason: 'no finished new version' }
  const candidate = useLabEventCount(modelId, series('new_data_holdout'))
  const current = useLabEventCount(modelId, series('current_new_data_holdout'))

  if (candidate.status === 'loading' || current.status === 'loading') {
    return (
      <p className="text-[10px] text-muted-foreground">Checking criteria…</p>
    )
  }
  const blank = { rmse: null, r2: null, mae: null, residualSd: null }
  const version = (s: typeof candidate) =>
    s.status === 'ready'
      ? { ...s.atEvents, residualSd: s.spreadsAtEvents.residualSd }
      : blank
  // The lab values are the same rows on both series — read from the new
  // version's, by the same lab-event rule.
  const figures = {
    candidate: version(candidate),
    current: version(current),
    targetSd:
      candidate.status === 'ready' ? candidate.spreadsAtEvents.targetSd : null,
  }
  const why =
    candidate.status === 'unavailable'
      ? candidate.reason
      : current.status === 'unavailable'
        ? current.reason
        : null

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/10 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Your acceptance criteria, at lab events
      </p>
      {criteria.map(c => {
        const result = evaluateRetrainCriterion(c, figures)
        const label = retrainCriterionLabel(c)
        return (
          <p key={label} className="text-xs text-foreground">
            <span className="font-medium">
              {result.verdict === 'pass'
                ? 'Pass'
                : result.verdict === 'fail'
                  ? 'Fail'
                  : 'Not evaluated'}
            </span>
            {' — '}
            {label}: {fmt(result.left.value)} vs {fmt(result.right.value)}
            {result.verdict === 'not-evaluated' && why ? ` (${why})` : ''}
          </p>
        )
      })}
      <p className="text-[10px] text-muted-foreground">
        A stated result only — the retrain and Apply to Production are not
        blocked by it.
      </p>
    </div>
  )
}
