'use client'

import { useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  AlertTriangle,
  Ban,
  Braces,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hash,
  History,
  Loader2,
  Package,
  Ruler,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { RunComparisonPanel } from './run-comparison-panel'
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
 *
 * CARDS COLLAPSE (2026-09-08). This panel sits in Step 3's narrow right
 * column beside SplitDistributionPanel and RuntimeEstimate, and a draft
 * commonly holds five or more runs — at the previous card height that was a
 * column a user scrolls past rather than reads. What stays visible is what a
 * reader scans for and what they act on: identity, status, the headline
 * metric, the Compare checkbox and Apply. The provenance and hyperparameter
 * detail MODEL-FLOW-012 exists to record is one click away rather than
 * removed. Apply deliberately stays in the collapsed header rather than
 * inside the disclosure — it is this panel's whole purpose, and a card that
 * must be expanded before it can be acted on hides the one control the
 * feature was built for. The count line in `Header` went the other way: it
 * said what the footer already says, twice on one screen.
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
  // so the selection badge needs the same refetch.
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
      <section className="space-y-2">
        <Header />
        <Skeleton className="h-16 w-full rounded-xl" />
      </section>
    )
  }

  // `selectedRunId` is server-side draft state written by Step 4's own
  // Select (MODEL-FLOW-019-T08 — Step 3 no longer writes it), not a wizard
  // atom, so MODEL-FLOW-012 AC1's "every value comes from a run row" is
  // unaffected. Only DISPLAYED here as the "Step 4" badge below.
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
    <section className="space-y-2">
      <Header />
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
              className="h-7 shrink-0 cursor-pointer px-2 text-[11px]"
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

/** Title only — the compare count lives in the footer, which is where
 *  MODEL-FLOW-019-T08 put it; carrying it here as well stated one fact
 *  twice on one screen. */
function Header() {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <History className="h-3 w-3" />
      Run parameters
    </p>
  )
}

/** One provenance line: an icon, a mono value, and the full value on hover.
 *  Every entry is a key, digest or figure whose useful form is the whole
 *  string, so each truncates rather than wraps. */
function Provenance({
  icon: Icon,
  value,
  title,
}: {
  icon: typeof Clock
  value: string
  title: string
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"
      title={title}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate font-mono">{value}</span>
    </span>
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
  // Initial state only, deliberately: a card the user opened stays open when
  // a newer run arrives and takes `latest` away from it.
  const [open, setOpen] = useState(latest)
  const panelId = `run-detail-${run.id}`

  const algorithm = run.algorithm as Algorithm
  const algorithmLabel = ALGORITHM_LABELS[algorithm] ?? run.algorithm
  const status = STATUS_META[run.status]
  const StatusIcon = status.icon
  const nonTerminal = run.status === 'QUEUED' || run.status === 'RUNNING'
  const runFailed = run.status === 'FAILED' || run.status === 'CANCELED'
  const rows = classifyHyperparams(run.algorithm, run.hyperparameters)
  const seedUsed = seedConsumedBy(run.algorithm)
  const rmse = typeof run.metrics?.rmse === 'number' ? run.metrics.rmse : null

  // Guarded, not assumed finite: a CV run's splitSpec is
  // {method:'cv_expanding', n_splits} with no `ratio` at all, so this reads
  // NaN there — the defect the removed Split tile was rendering as
  // "NaN% / NaN%". Absent rather than wrong.
  const splitPct = splitPercentFromRun(run.splitSpec)
  const splitText = Number.isFinite(splitPct)
    ? `${splitPct}/${100 - splitPct} split`
    : null

  const crossAlgorithm =
    currentAlgorithms.length !== 1 || currentAlgorithms[0] !== run.algorithm
  const targetMismatch = datasetTags
    ? !datasetTags.includes(run.targetY)
    : false

  const compareDisabledReason = nonTerminal
    ? 'Available once this run finishes.'
    : runFailed
      ? "This run didn't succeed — it has no metrics to compare."
      : null

  return (
    <div
      className={cn(
        'rounded-xl bg-card transition-colors',
        isCompared
          ? 'bg-emerald-500/4 ring-2 ring-emerald-500 dark:ring-emerald-400'
          : 'ring-1 ring-foreground/10',
      )}
    >
      {/* Header — checkbox, disclosure toggle and Apply as SIBLINGS, never a
          button inside a button: nesting them would be invalid HTML and
          would need stopPropagation to behave, which is the tell that the
          structure was wrong rather than the handler. */}
      <div className="flex items-start gap-2 p-3">
        <label
          htmlFor={`compare-${run.id}`}
          className={cn(
            'mt-0.5 flex shrink-0 rounded-full p-1 transition-colors focus-within:ring-2 focus-within:ring-ring',
            compareDisabledReason ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
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
            className="size-4 cursor-pointer rounded-full border-border data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white dark:data-[state=checked]:border-emerald-400 dark:data-[state=checked]:bg-emerald-400 dark:data-[state=checked]:text-emerald-950"
          />
        </label>

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="min-w-0 flex-1 cursor-pointer space-y-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {algorithmLabel}
            </span>
            {latest && (
              <Badge
                variant="secondary"
                className="h-4 shrink-0 px-1.5 text-[9px] font-medium"
              >
                latest
              </Badge>
            )}
            {isCarryForward && (
              <Badge
                variant="outline"
                className="h-4 shrink-0 gap-0.5 border-primary/40 px-1.5 text-[9px] font-medium text-primary"
                title="This run opens in Model Selection (Step 4)."
              >
                <CheckCircle2 className="h-2.5 w-2.5" />
                Step 4
              </Badge>
            )}
            {targetMismatch && !nonTerminal && !open && (
              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
            )}
            <span className="ml-auto flex shrink-0 items-baseline gap-1">
              <span className="text-[9px] uppercase text-muted-foreground">
                rmse
              </span>
              <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                {run.status === 'SUCCEEDED' && rmse !== null
                  ? METRIC_META.rmse.format(rmse)
                  : '—'}
              </span>
            </span>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="flex shrink-0 items-center gap-1 font-mono">
              <Clock className="h-3 w-3 shrink-0" />
              {formatRunTimestamp(run.createdAt)}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <StatusIcon className={cn('h-3 w-3', status.className)} />
              {status.label}
            </span>
            <span className="min-w-0 truncate">
              y ={' '}
              <span className="font-medium text-foreground">{run.targetY}</span>
            </span>
          </div>
        </button>

        {/* This panel's whole purpose, so it stays reachable without
            expanding — MODEL-FLOW-012's Apply, unchanged in behaviour. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 cursor-pointer px-2 text-[10px]"
            disabled={nonTerminal}
            title={
              nonTerminal
                ? 'Available once this run finishes.'
                : 'Load these parameters into Training Config'
            }
            onClick={() => onApply(run)}
          >
            Apply
          </Button>
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? 'Hide run detail' : 'Show run detail'}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>

      {open && (
        <div
          id={panelId}
          className="space-y-2 border-t border-border/60 px-3 pt-2.5 pb-3"
        >
          {/* Hyperparameters — the record MODEL-FLOW-012 exists to keep, so
              it is disclosed rather than dropped. A value the estimator does
              not read still shows, labelled, per that feature's own AC2. */}
          <div className="flex flex-wrap items-center gap-1">
            {rows.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">
                No hyperparameters recorded for this run.
              </span>
            ) : (
              rows.map(r => (
                <span
                  key={r.key}
                  className={cn(
                    'inline-flex items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px]',
                    !r.consumed && 'opacity-60',
                  )}
                  title={
                    r.consumed
                      ? undefined
                      : `${algorithmLabel} does not read this hyperparameter — it had no effect on the fit.`
                  }
                >
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {String(r.value)}
                  </span>
                  {!r.consumed && (
                    <span className="text-[8px] uppercase text-muted-foreground">
                      unused
                    </span>
                  )}
                </span>
              ))
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            <Provenance
              icon={Package}
              value={shortDigest(run.imageDigest)}
              title={`Trainer image ${run.imageDigest}`}
            />
            {splitText && (
              <Provenance
                icon={Ruler}
                value={splitText}
                title={`Train ${splitPct}% / test ${100 - splitPct}% — Apply writes this ratio back into Training Config.`}
              />
            )}
            {seedUsed && (
              <Provenance
                icon={Hash}
                value={`seed ${run.seed}`}
                title="Estimator seed — this algorithm consumes it."
              />
            )}
            {run.splitStats && (
              <Provenance
                icon={Ruler}
                value={`${run.splitStats.source_rows.toLocaleString()} rows · ${run.splitStats.distinct_labelled_values.toLocaleString()} distinct`}
                title={`Sized against ${run.splitStats.source_rows.toLocaleString()} rows holding ${run.splitStats.distinct_labelled_values.toLocaleString()} distinct labelled values. Model capacity should follow the second number, not the first.`}
              />
            )}
            {run.featureSpecKey && (
              <Provenance
                icon={Braces}
                value={run.featureSpecKey}
                title={run.featureSpecKey}
              />
            )}
          </div>

          {run.failureReason && (
            <p className="text-[10px] text-destructive">{run.failureReason}</p>
          )}

          {crossAlgorithm && !nonTerminal && (
            <p className="rounded-md bg-muted/60 px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
              Applying switches the algorithm to {algorithmLabel} and reduces
              the candidate list to it alone.
            </p>
          )}

          {targetMismatch && !nonTerminal && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                {run.targetY} isn&apos;t a tag on the currently selected dataset
                — Apply will still set it, and this run can still be compared
                and opened in Model Selection, but Start Training will reject it
                until Target variable is corrected.
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
              Compare is unavailable — this run didn&apos;t succeed, so it has
              no metrics to compare.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
