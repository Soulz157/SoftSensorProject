'use client'

import { useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  AlertTriangle,
  Ban,
  Braces,
  CheckCircle2,
  Clock,
  Cpu,
  Gauge,
  Hash,
  History,
  Loader2,
  Package,
  Percent,
  Ruler,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ALGORITHM_LABELS,
  mpAlgorithmsAtom,
  mpCompareRunIdsAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
  type Algorithm,
} from '@/store/model-pipeline'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useDraftSelection } from '@/hooks/model/use-draft-selection'
import { useApplyRunParams } from '@/hooks/model/use-apply-run-params'
import {
  classifyHyperparams,
  seedConsumedBy,
  splitPercentFromRun,
} from '@/lib/run-params'
import { METRIC_META } from '@/lib/model-metrics'
import type {
  ModelRunStatus,
  ModelTrainingRunListItem,
} from '@/services/model-draft'

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background p-3 text-center text-[11px] text-muted-foreground">
      {children}
    </div>
  )
}

const STATUS_META: Record<
  ModelRunStatus,
  { label: string; icon: typeof Clock; className: string }
> = {
  QUEUED: { label: 'Queued', icon: Clock, className: 'text-muted-foreground' },
  RUNNING: {
    label: 'Running',
    icon: Loader2,
    className: 'text-primary animate-spin',
  },
  SUCCEEDED: {
    label: 'Succeeded',
    icon: CheckCircle2,
    className: 'text-emerald-500',
  },
  FAILED: { label: 'Failed', icon: AlertTriangle, className: 'text-red-500' },
  CANCELED: {
    label: 'Canceled',
    icon: Ban,
    className: 'text-muted-foreground',
  },
}

function shortDigest(digest: string): string {
  const bare = digest.startsWith('sha256:') ? digest.slice(7) : digest
  return bare.length > 12 ? `${bare.slice(0, 12)}…` : bare
}

function formatRunTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * MODEL-FLOW-012 — everything that produced a terminal (or in-flight) run,
 * read from the run row and nothing else. Acceptance criterion 1 still
 * governs: no field on these cards comes from a wizard atom or the current
 * draft, which is also why there is no "Loss function" field — T01's audit
 * found the run row has no such column (it is never sent to the trainer, see
 * LOSS_OPTIONS' own doc comment), so recalling it here would mean rendering
 * the CURRENT form value beside a finished run's other parameters — the exact
 * provenance-theatre failure this feature exists to avoid. The wizard atoms
 * read below (`mpAlgorithmsAtom`, `mpSelectedDatasetAtom`) are only COMPARED
 * against the row to warn about what an action will do; they are never
 * displayed as if they were the run's own values.
 *
 * One card per run, in the DatasetCard zone layout (identity / metrics /
 * provenance / action). The old `Select` existed only because the sidebar had
 * no room for more than one run at a time; its per-run timestamp now sits in
 * each card's identity line.
 *
 * MODEL-FLOW-021 replaced MODEL-FLOW-018-T03's per-card Select with a
 * Compare checkbox — distinct from Apply, which seeds the NEXT run's
 * configuration. Neither changes configuration: neither relocks, clears
 * trainState, nor fires a /split-stats fetch (all three stay Apply-only, via
 * `useApplyRunParams`'s own `useCommitRunConfig` call, untouched here).
 *
 * MODEL-FLOW-019-T08 (resolved 2026-09-07) REVERSED MODEL-FLOW-021's own
 * footer design: the footer below reports a COUNT and nothing else — no
 * "Use this run" picker, no Select, no destination promise. Nothing in this
 * panel writes `ModelDraft.selectedRunId` any more (Step 4's own Select is
 * the only writer) or a step atom (the wizard shell's forward button is the
 * only control that advances to Step 4, gated by `canAdvance(3)`). THE
 * CHECKBOX STILL WRITES NOTHING SERVER-SIDE — `compareRunIds` is client-only
 * view state, lifted to `mpCompareRunIdsAtom` so Step 4 can read the same
 * set and implement the same empty-means-all rule.
 */
export function RunParamsPanel() {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const currentAlgorithms = useAtomValue(mpAlgorithmsAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const trainStatus = useAtomValue(mpTrainStateAtom).status
  const { runs, loading, error, refetch } = useDraftRuns(draftId)
  const { selectedRunId, refetch: refetchSelection } =
    useDraftSelection(draftId)
  const { applyRun } = useApplyRunParams()

  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)
  /**
   * MODEL-FLOW-021, lifted to a shared atom by MODEL-FLOW-019-T08 part 3 so
   * Step 4 can read the same set. Still a view preference, not draft state:
   * it fires no request, survives nothing beyond the wizard session, and is
   * not what Step 4 opens with independently.
   *
   * EMPTY MEANS EVERY RUN, not "no runs". Checking nothing is how a user
   * asks to compare the whole list, so the empty set is the DEFAULT view
   * rather than an empty state — and un-checking the last box returns to it
   * rather than emptying the table.
   */
  const [compareRunIds, setCompareRunIds] = useAtom(mpCompareRunIdsAtom)

  const toggleCompare = (run: ModelTrainingRunListItem) =>
    setCompareRunIds(prev => {
      const next = new Set(prev)
      if (next.has(run.id)) next.delete(run.id)
      else next.add(run.id)
      return next
    })

  // Phase3TrainingConfig — and this panel with it — stays mounted for the
  // whole training cycle; nothing else remounts it when a run reaches a
  // terminal state. Without this, `refetch` is dead code and the list keeps
  // showing "No training run yet" through a run's entire lifetime. Every
  // trainState transition (queued -> training -> done/error) is worth a
  // refetch, not just 'done': it is also what makes the QUEUED/RUNNING
  // Apply-disabled branch reachable for a run just started. A fresh launch
  // also clears `ModelDraft.selectedRunId` server-side (MODEL-FLOW-018-T02),
  // so the selection footer needs the same refetch.
  useEffect(() => {
    refetch()
    refetchSelection()
  }, [trainStatus, refetch, refetchSelection])

  const handleApply = (run: ModelTrainingRunListItem) => {
    const { dropped } = applyRun(run)
    const label = ALGORITHM_LABELS[run.algorithm as Algorithm] ?? run.algorithm
    setAppliedMessage(
      `Applied ${label}'s parameters.` +
        (dropped.length
          ? ` Skipped ${dropped.join(', ')} — not a valid value.`
          : ''),
    )
  }

  if (!draftId || loading) {
    return (
      <section className="space-y-3">
        <Header comparing={0} total={0} onClear={() => {}} />
        <Skeleton className="h-28 w-full rounded-xl" />
      </section>
    )
  }

  // `selectedRunId` is server-side draft state written by Step 4's own
  // Select (MODEL-FLOW-019-T08 — Step 3 no longer writes it), not a wizard
  // atom, so MODEL-FLOW-012 AC1's "every value comes from a run row" is
  // unaffected. Only DISPLAYED here as the "Model Selection" badge below.
  const terminalRuns = runs.filter(run => run.status === 'SUCCEEDED')

  // MODEL-FLOW-019-T08. `mpCompareRunIdsAtom` is never pruned or reset on a
  // per-draft basis, so a stale id from a previous draft/session must not
  // keep the set "non-empty" and silently narrow the count to zero — every
  // read below goes through this intersected set, never the raw atom, so
  // this panel's own count and Step 4's table can never disagree about what
  // is ticked.
  const activeCompareIds = new Set(
    [...compareRunIds].filter(id => runs.some(run => run.id === id)),
  )
  const comparedTerminal = terminalRuns.filter(run =>
    activeCompareIds.has(run.id),
  )

  return (
    <section className="space-y-3">
      <Header
        comparing={comparedTerminal.length}
        total={terminalRuns.length}
        onClear={() => setCompareRunIds(new Set())}
      />
      {error && <EmptyPanel>Could not load training runs — {error}</EmptyPanel>}
      {!error && runs.length === 0 && (
        <EmptyPanel>
          No training run yet — start training above to see its parameters here.
        </EmptyPanel>
      )}
      {/* Server-ordered most-recent-first (listDraftRunsService orders by
          createdAt desc) — index 0 is the latest. */}
      {!error &&
        runs.map((run, i) => (
          <RunCard
            key={run.id}
            run={run}
            latest={i === 0}
            currentAlgorithms={currentAlgorithms}
            datasetTags={selectedDataset ? selectedDataset.tags : null}
            isCompared={activeCompareIds.has(run.id)}
            isCarryForward={run.id === selectedRunId}
            onApply={handleApply}
            onToggleCompare={toggleCompare}
          />
        ))}
      {appliedMessage && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          {appliedMessage}
        </p>
      )}

      {/* MODEL-FLOW-019-T08 (resolved 2026-09-07): the footer reports a
          COUNT and nothing else — no picker, no Select, no destination
          promise, no step navigation. The wizard shell's own forward
          button is the single control that advances Step 3 -> Step 4,
          gated by `canAdvance(3)`. */}
      {terminalRuns.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="min-w-0 text-[11px] text-muted-foreground">
            {activeCompareIds.size === 0 ? (
              <>
                Nothing ticked — comparing{' '}
                <span className="font-medium text-foreground">
                  all {terminalRuns.length} run
                  {terminalRuns.length === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {comparedTerminal.length} of {terminalRuns.length}
                </span>{' '}
                run{comparedTerminal.length === 1 ? '' : 's'} selected to
                compare
              </>
            )}
          </p>
          {activeCompareIds.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 cursor-pointer px-2 text-[11px]"
              onClick={() => setCompareRunIds(new Set())}
            >
              Compare all
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function Header({
  comparing,
  total,
  onClear,
}: {
  comparing: number
  total: number
  onClear: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <History className="h-3 w-3" />
        Run parameters
      </p>
      {total > 1 && (
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] text-muted-foreground">
            {comparing === 0
              ? `Comparing all ${total} runs — tick Compare to narrow`
              : `Comparing ${comparing} of ${total}`}
          </p>
          {comparing > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 cursor-pointer px-2 text-[10px]"
              onClick={onClear}
            >
              Compare all
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" /> {label}
      </p>
      <p className="truncate font-mono text-sm font-medium text-foreground">
        {value}
      </p>
      {hint && (
        <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function RunCard({
  run,
  latest,
  currentAlgorithms,
  datasetTags,
  isCompared,
  isCarryForward,
  onApply,
  onToggleCompare,
}: {
  run: ModelTrainingRunListItem
  latest: boolean
  currentAlgorithms: readonly string[]
  datasetTags: readonly string[] | null
  isCompared: boolean
  isCarryForward: boolean
  onApply: (run: ModelTrainingRunListItem) => void
  onToggleCompare: (run: ModelTrainingRunListItem) => void
}) {
  const algorithm = run.algorithm as Algorithm
  const algorithmLabel = ALGORITHM_LABELS[algorithm] ?? run.algorithm
  const status = STATUS_META[run.status]
  const StatusIcon = status.icon
  const nonTerminal = run.status === 'QUEUED' || run.status === 'RUNNING'
  const rows = classifyHyperparams(run.algorithm, run.hyperparameters)
  const seedUsed = seedConsumedBy(run.algorithm)
  const splitPct = splitPercentFromRun(run.splitSpec)
  const rmse = typeof run.metrics?.rmse === 'number' ? run.metrics.rmse : null

  const crossAlgorithm =
    currentAlgorithms.length !== 1 || currentAlgorithms[0] !== run.algorithm

  const targetMismatch = datasetTags
    ? !datasetTags.includes(run.targetY)
    : false

  const runFailed = run.status === 'FAILED' || run.status === 'CANCELED'

  const compareDisabledReason = nonTerminal
    ? 'Available once this run finishes.'
    : runFailed
      ? "This run didn't succeed — it has no metrics to compare."
      : null

  return (
    <div
      className={`group relative flex flex-col gap-4 rounded-xl bg-card p-4 pt-12 transition-colors sm:pt-4 ${
        isCompared
          ? 'bg-emerald-500/4 ring-2 ring-emerald-500 dark:ring-emerald-400'
          : 'ring-1 ring-foreground/10 hover:bg-muted/40'
      }`}
    >
      <label
        htmlFor={`compare-${run.id}`}
        className={`absolute right-3 top-3 z-10 flex p-2 items-center gap-2 rounded-full border  text-[11px] font-medium transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-card ${
          compareDisabledReason
            ? 'cursor-not-allowed border-border/60 text-muted-foreground/60'
            : isCompared
              ? 'cursor-pointer border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'cursor-pointer border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        }`}
        title={
          compareDisabledReason ?? 'Include this run in the comparison below'
        }
      >
        <Checkbox
          id={`compare-${run.id}`}
          checked={isCompared}
          disabled={compareDisabledReason !== null}
          aria-label={`Compare ${algorithmLabel}`}
          onCheckedChange={() => onToggleCompare(run)}
          className="cursor-pointer size-5 rounded-full border-border data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white dark:data-[state=checked]:border-emerald-400 dark:data-[state=checked]:bg-emerald-400 dark:data-[state=checked]:text-emerald-950"
        />
      </label>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6 sm:pr-32">
        {/* Zone 1 — identity */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Cpu className="h-5 w-5" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">
                {algorithmLabel}
              </span>
              {latest && (
                <Badge
                  variant="secondary"
                  className="shrink-0 font-medium text-foreground"
                >
                  latest
                </Badge>
              )}
              {isCarryForward && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-primary/40 font-medium text-primary"
                  title="This run opens in Model Selection (Step 4)."
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Model Selection
                </Badge>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex shrink-0 items-center gap-1">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono">
                  {formatRunTimestamp(run.createdAt)}
                </span>
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 gap-1.5 font-medium text-foreground"
              >
                <StatusIcon className={`h-3 w-3 ${status.className}`} />
                {status.label}
              </Badge>
            </div>
            <div className="min-w-0 truncate text-[11px] text-muted-foreground">
              y ={' '}
              <span className="font-medium text-foreground">{run.targetY}</span>
            </div>
          </div>
        </div>

        {/* Zone 2 — metrics */}
        <div className="grid shrink-0 grid-cols-2 gap-x-8 border-t border-border pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <Metric
            icon={Percent}
            label="Split"
            value={`${splitPct}% / ${100 - splitPct}%`}
            hint="train / test"
          />
          <Metric
            icon={Gauge}
            label="RMSE"
            value={
              run.status === 'SUCCEEDED' && rmse !== null
                ? METRIC_META.rmse.format(rmse)
                : '—'
            }
          />
        </div>

        {/* Zone 3 — provenance */}
        <div className="flex shrink-0 flex-col gap-0.5 text-[11px] text-muted-foreground sm:items-end">
          <span className="flex items-center gap-1" title={run.imageDigest}>
            <Package className="h-3 w-3 shrink-0" />
            <span className="font-mono">{shortDigest(run.imageDigest)}</span>
          </span>
          {run.featureSpecKey && (
            <span
              className="flex min-w-0 max-w-55 items-center gap-1"
              title={run.featureSpecKey}
            >
              <Braces className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{run.featureSpecKey}</span>
            </span>
          )}
          {seedUsed && (
            <span className="flex items-center gap-1" title="Estimator seed">
              <Hash className="h-3 w-3 shrink-0" />
              <span className="font-mono">{run.seed}</span>
            </span>
          )}

          {run.splitStats && (
            <span
              className="flex items-center gap-1"
              title={`Sized against ${run.splitStats.source_rows.toLocaleString()} rows holding ${run.splitStats.distinct_labelled_values.toLocaleString()} distinct labelled values. Model capacity should follow the second number, not the first.`}
            >
              <Ruler className="h-3 w-3 shrink-0" />
              <span className="font-mono">
                {run.splitStats.source_rows.toLocaleString()} rows ·{' '}
                {run.splitStats.distinct_labelled_values.toLocaleString()}{' '}
                distinct
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Detail row — variable-length content that would break the zone grid */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Hyperparameters
          </span>
          {rows.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">
              No hyperparameters recorded for this run.
            </span>
          ) : (
            rows.map(r => (
              <span
                key={r.key}
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px]"
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="font-mono tabular-nums text-foreground">
                  {String(r.value)}
                </span>
                {!r.consumed && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px] font-normal"
                    title={`${algorithmLabel} does not read this hyperparameter — it had no effect on the fit.`}
                  >
                    not used
                  </Badge>
                )}
              </span>
            ))
          )}
        </div>

        {run.failureReason && (
          <p className="text-[11px] text-destructive">{run.failureReason}</p>
        )}

        {crossAlgorithm && !nonTerminal && (
          <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Applying switches the algorithm to {algorithmLabel} and reduces the
            candidate list to it alone.
          </p>
        )}

        {targetMismatch && !nonTerminal && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>
              {run.targetY} isn&apos;t a tag on the currently selected dataset —
              Apply will still set it, and this run can still be compared and
              opened in Model Selection, but Start Training will reject it until
              Target variable is corrected.
            </span>
          </p>
        )}

        {nonTerminal && (
          <p className="text-[10px] text-muted-foreground">
            Apply and Compare are available once this run finishes.
          </p>
        )}

        {!nonTerminal && runFailed && (
          <p className="text-[10px] text-muted-foreground">
            Compare is unavailable — this run didn&apos;t succeed, so it has no
            metrics to compare.
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer"
            disabled={nonTerminal}
            onClick={() => onApply(run)}
          >
            Apply to Training Config
          </Button>
        </div>
      </div>
    </div>
  )
}
