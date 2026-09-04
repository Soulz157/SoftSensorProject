'use client'

import { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertTriangle,
  ArrowRight,
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
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ALGORITHM_LABELS,
  mpAlgorithmsAtom,
  mpCandidateJobIdAtom,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
  type Algorithm,
} from '@/store/model-pipeline'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useDraftSelection } from '@/hooks/model/use-draft-selection'
import { useApplyRunParams } from '@/hooks/model/use-apply-run-params'
import { useCandidateJob } from '@/hooks/model/use-candidate-job'
import {
  classifyHyperparams,
  seedConsumedBy,
  splitPercentFromRun,
} from '@/lib/run-params'
import { METRIC_META } from '@/lib/model-metrics'
import { modelDraftService } from '@/services/model-draft'
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
 * read below (`mpAlgorithmsAtom`, `mpSelectedDatasetAtom`, and MODEL-FLOW-018-
 * T03's `mpCandidateJobIdAtom`) are only COMPARED against the row to warn
 * about what an action will do; they are never displayed as if they were the
 * run's own values.
 *
 * One card per run, in the DatasetCard zone layout (identity / metrics /
 * provenance / action). The old `Select` existed only because the sidebar had
 * no room for more than one run at a time; its per-run timestamp now sits in
 * each card's identity line.
 *
 * MODEL-FLOW-018-T03. A second per-run action, Select, decides which
 * FINISHED run carries forward into Model Selection — distinct from Apply,
 * which seeds the NEXT run's configuration. Select changes no configuration:
 * it relocks nothing, clears no trainState, and fires no /split-stats fetch
 * (all three stay Apply-only, via `useApplyRunParams`'s own
 * `useCommitRunConfig` call, untouched here). Mark-and-stay, not navigate —
 * a single Select persists a server-side choice (`ModelDraft.selectedRunId`)
 * and a panel-level footer offers the move to Step 4 once one exists.
 */
export function RunParamsPanel() {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const currentAlgorithms = useAtomValue(mpAlgorithmsAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const trainStatus = useAtomValue(mpTrainStateAtom).status
  const candidateJobId = useAtomValue(mpCandidateJobIdAtom)
  const { runs, loading, error, refetch } = useDraftRuns(draftId)
  const { selectedRunId, refetch: refetchSelection } =
    useDraftSelection(draftId)
  const { applyRun } = useApplyRunParams()
  // MODEL-FLOW-018-T03. Raw setters, not `useModelPipelineNav().next()`:
  // `next()` advances from `mpCurrentStepAtom`'s CURRENT value, which this
  // panel does not own and cannot assume is still 3 — Select persists a
  // server-side choice and the footer below can render on a remount days
  // later from wherever the wizard happens to be. The CTA's own label is
  // the destination it promises, so it writes that destination directly.
  // `highestUnlocked` is raised the same way Apply's own relock does
  // (useCommitRunConfig) — a SUCCEEDED run the user just selected IS the
  // evidence Step 4 is reachable, the same fact `canAdvance(3)`'s
  // trainState-done check exists to establish.
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)
  // Compared against each run's own `candidateJobId`, never displayed — the
  // one live job (if any) is the only one that can still be QUEUED/RUNNING;
  // an older job a run might belong to is guaranteed terminal by the
  // (draftId)-scoped one-live-job index, so there is nothing to fetch for it.
  const { job: liveJob } = useCandidateJob(draftId, candidateJobId)

  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)
  const [selectingRunId, setSelectingRunId] = useState<string | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)

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

  const handleSelect = async (run: ModelTrainingRunListItem) => {
    if (!draftId) return
    setSelectingRunId(run.id)
    setSelectError(null)
    try {
      await modelDraftService.selectRun(draftId, run.id)
      refetchSelection()
    } catch (err) {
      setSelectError(
        err instanceof Error ? err.message : 'Could not record that selection.',
      )
    } finally {
      setSelectingRunId(null)
    }
  }

  if (!draftId || loading) {
    return (
      <section className="space-y-3">
        <Header />
        <Skeleton className="h-28 w-full rounded-xl" />
      </section>
    )
  }

  // `selectedRunId` gates WHICH card shows "Carrying forward" and whether
  // the footer renders at all — it is server-side draft state (written by
  // Save-Model-adoption's own resolver), not a wizard atom, so MODEL-FLOW-
  // 012 AC1's "every value comes from a run row" is unaffected: it exists to
  // refuse a CURRENT-FORM value rendered as though it belonged to a past
  // run, and this is neither. The footer's own DISPLAYED values (algorithm,
  // timestamp) still come from `carryingForwardRun` — the row itself.
  const carryingForwardRun = runs.find(run => run.id === selectedRunId) ?? null

  return (
    <section className="space-y-3">
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
            isSelected={run.id === selectedRunId}
            selecting={selectingRunId === run.id}
            liveJobId={liveJob?.id ?? null}
            liveJobStatus={liveJob?.status ?? null}
            onApply={handleApply}
            onSelect={handleSelect}
          />
        ))}

      {appliedMessage && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          {appliedMessage}
        </p>
      )}

      {selectError && (
        <p className="text-[11px] text-destructive">{selectError}</p>
      )}

      {/* MODEL-FLOW-018 openDecision (2026-09-03): mark-and-stay + footer
          CTA, not navigate-on-Select — one selected run is a choice, not a
          comparison, and every selectable run is already comparable once it
          reaches Step 4 (no marked-set to carry along). */}
      {carryingForwardRun && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="min-w-0 text-[11px] text-foreground">
            Carrying forward:{' '}
            <span className="font-medium">
              {ALGORITHM_LABELS[carryingForwardRun.algorithm as Algorithm] ??
                carryingForwardRun.algorithm}
            </span>
            {' · '}
            <span className="font-mono text-muted-foreground">
              {formatRunTimestamp(carryingForwardRun.createdAt)}
            </span>
          </p>
          <Button
            size="sm"
            className="shrink-0 cursor-pointer gap-1.5"
            onClick={() => {
              setHighestUnlocked(prev => Math.max(prev, 4))
              setCurrentStep(4)
            }}
          >
            Compare in Model Selection
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </section>
  )
}

function Header() {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <History className="h-3 w-3" />
      Run parameters
    </p>
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
  isSelected,
  selecting,
  liveJobId,
  liveJobStatus,
  onApply,
  onSelect,
}: {
  run: ModelTrainingRunListItem
  latest: boolean
  currentAlgorithms: readonly string[]
  datasetTags: readonly string[] | null
  isSelected: boolean
  selecting: boolean
  liveJobId: string | null
  liveJobStatus: ModelRunStatus | null
  onApply: (run: ModelTrainingRunListItem) => void
  onSelect: (run: ModelTrainingRunListItem) => void
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

  // A run outlives the dataset selection that produced it — Step 2 lets the
  // user pick a different dataset for the same draft. Applying a target that
  // isn't one of the CURRENT dataset's tags still writes (Apply has no
  // dataset opinion), but Start Training would then 400 on
  // `dto.targetY in meta.tags` server-side. Named here so that failure isn't
  // a surprise, rather than silently fixed by omitting the write.
  //
  // MODEL-FLOW-018-T02's own finding: for SELECT this is a WARNING, never a
  // refusal — saveDraftService derives the whole saved config from the
  // adopted run, never from the draft's current `datasetId`, so a mismatch
  // against Step 2's CURRENT dataset creates no inconsistency at Save Model.
  const targetMismatch = datasetTags
    ? !datasetTags.includes(run.targetY)
    : false

  // MODEL-FLOW-012-T11's deferred job-level rule, discharged here
  // (MODEL-FLOW-018-T03, finding 9): a SUCCEEDED run whose own candidate job
  // is still QUEUED/RUNNING is not selectable — that job may still overwrite
  // it, and a selection made mid-sweep has no coherent meaning.
  const jobStillLive =
    run.candidateJobId !== null &&
    run.candidateJobId === liveJobId &&
    (liveJobStatus === 'QUEUED' || liveJobStatus === 'RUNNING')
  const runFailed = run.status === 'FAILED' || run.status === 'CANCELED'

  const selectDisabledReason = nonTerminal
    ? 'Available once this run finishes.'
    : runFailed
      ? "This run didn't succeed — there is nothing to carry forward."
      : jobStillLive
        ? `This run's candidate job is still ${(liveJobStatus ?? '').toLowerCase()} — wait for it to finish.`
        : null

  return (
    <div className="group flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {/* Zone 1 — identity */}
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
              {isSelected && (
                <Badge
                  variant="secondary"
                  className="shrink-0 gap-1 font-medium text-primary"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Carrying forward
                </Badge>
              )}
            </div>
            {/* flex-wrap, not shrink-0 on a min-w-0 parent: the Select action
                adds a badge here and a second button in Zone 4, and the row
                used to overflow into the metrics column instead of wrapping. */}
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
              className="flex min-w-0 max-w-[220px] items-center gap-1"
              title={run.featureSpecKey}
            >
              <Braces className="h-3 w-3 shrink-0" />
              <span className="truncate font-mono">{run.featureSpecKey}</span>
            </span>
          )}
          {seedUsed && (
            <span
              className="flex items-center gap-1"
              title={
                seedUsed
                  ? 'Estimator seed'
                  : `Estimator seed — ${algorithmLabel} does not read it, so it had no effect on this fit.`
              }
            >
              <Hash className="h-3 w-3 shrink-0" />
              <span
                className={`font-mono ${seedUsed ? '' : 'line-through opacity-60'}`}
              >
                {run.seed}
              </span>
            </span>
          )}
        </div>

        {/* Zone 4 — actions. Apply seeds the NEXT run's configuration; Select
            (MODEL-FLOW-018-T03) decides which FINISHED run carries forward —
            two different actions, never merged into one control. */}
        <div className="flex shrink-0 flex-col gap-2">
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 cursor-pointer"
            disabled={nonTerminal}
            onClick={() => onApply(run)}
          >
            Apply to Training Config
          </Button>
          <Button
            size="sm"
            variant={isSelected ? 'secondary' : 'outline'}
            className="shrink-0 cursor-pointer"
            disabled={isSelected || selectDisabledReason !== null || selecting}
            title={selectDisabledReason ?? undefined}
            onClick={() => onSelect(run)}
          >
            {selecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isSelected ? (
              'Selected'
            ) : (
              'Select'
            )}
          </Button>
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
              Apply will still set it, and Select still carries this run
              forward, but Start Training will reject it until Target variable
              is corrected.
            </span>
          </p>
        )}

        {nonTerminal && (
          <p className="text-[10px] text-muted-foreground">
            Apply and Select are available once this run finishes.
          </p>
        )}

        {!nonTerminal && runFailed && (
          <p className="text-[10px] text-muted-foreground">
            Select is unavailable — this run didn&apos;t succeed, so there is
            nothing to carry forward.
          </p>
        )}

        {!nonTerminal && !runFailed && jobStillLive && (
          <p className="text-[10px] text-muted-foreground">
            Select is unavailable while this run&apos;s candidate job is still{' '}
            {(liveJobStatus ?? '').toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  )
}
