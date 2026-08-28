'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  History,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALGORITHM_LABELS,
  mpAlgorithmsAtom,
  mpSelectedDatasetAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
  type Algorithm,
} from '@/store/model-pipeline'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useApplyRunParams } from '@/hooks/model/use-apply-run-params'
import {
  classifyHyperparams,
  // seedConsumedBy,
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

/**
 * MODEL-FLOW-012 — everything that produced a terminal (or in-flight) run,
 * read from the run row and nothing else. Acceptance criterion 1 is the
 * governing rule here: no value in this component comes from a wizard atom
 * or the current draft, which is also why there is no "Loss function" row —
 * T01's audit found the run row has no such column (it is never sent to the
 * trainer, see LOSS_OPTIONS' own doc comment), so recalling it here would
 * mean reading `mpLossFunctionAtom` and rendering the CURRENT form value
 * beside a finished run's other parameters — the exact provenance-theatre
 * failure this feature exists to avoid.
 */
export function RunParamsPanel() {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const currentAlgorithms = useAtomValue(mpAlgorithmsAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const trainStatus = useAtomValue(mpTrainStateAtom).status
  const { runs, loading, error, refetch } = useDraftRuns(draftId)
  const { applyRun } = useApplyRunParams()

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null)

  // Phase3TrainingConfig — and this panel with it — stays mounted for the
  // whole training cycle; nothing else remounts it when a run reaches a
  // terminal state. Without this, `refetch` is dead code and the panel
  // keeps showing "No training run yet" through a run's entire lifetime.
  // Every trainState transition (queued -> training -> done/error) is worth
  // a refetch, not just 'done': it is also what makes the QUEUED/RUNNING
  // Apply-disabled branch below reachable for a run just started.
  useEffect(() => {
    refetch()
  }, [trainStatus, refetch])

  // Runs are server-ordered most-recent-first (listDraftRunsService orders
  // by createdAt desc) — default to the latest, and follow along if it
  // disappears from the list (e.g. a stale selection after a refetch).
  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null)
      return
    }
    if (!runs.some(r => r.id === selectedRunId)) {
      setSelectedRunId(runs[0]!.id)
    }
  }, [runs, selectedRunId])

  const run = useMemo(
    () => runs.find(r => r.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  )

  const crossAlgorithm = run
    ? currentAlgorithms.length !== 1 || currentAlgorithms[0] !== run.algorithm
    : false

  // A run outlives the dataset selection that produced it — Step 2 lets the
  // user pick a different dataset for the same draft. Applying a target
  // that isn't one of the CURRENT dataset's tags still writes (Apply has no
  // dataset opinion), but Start Training would then 400 on
  // `dto.targetY in meta.tags` server-side. Named here so that failure
  // isn't a surprise, rather than silently fixed by omitting the write.
  const targetMismatch =
    run && selectedDataset ? !selectedDataset.tags.includes(run.targetY) : false

  const handleApply = () => {
    if (!run) return
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
      <div className="space-y-3 border-t border-border/50 pt-3">
        <Header />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <div className="items-center justify-between gap-2">
        <div className="mb-2">
          <Header />
        </div>
        {runs.length > 1 && (
          <Select
            value={selectedRunId ?? undefined}
            onValueChange={setSelectedRunId}
          >
            <SelectTrigger className="cursor-pointer h-7 w-auto gap-1 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {runs.map(r => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  {ALGORITHM_LABELS[r.algorithm as Algorithm] ?? r.algorithm} ·{' '}
                  {new Date(r.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error && <EmptyPanel>Could not load training runs — {error}</EmptyPanel>}

      {!error && runs.length === 0 && (
        <EmptyPanel>
          No training run yet — start training above to see its parameters here.
        </EmptyPanel>
      )}

      {!error && run && (
        <RunDetails
          run={run}
          crossAlgorithm={crossAlgorithm}
          targetMismatch={targetMismatch}
          onApply={handleApply}
        />
      )}

      {appliedMessage && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          {appliedMessage}
        </p>
      )}
    </div>
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

function RunDetails({
  run,
  crossAlgorithm,
  targetMismatch,
  onApply,
}: {
  run: ModelTrainingRunListItem
  crossAlgorithm: boolean
  targetMismatch: boolean
  onApply: () => void
}) {
  const algorithm = run.algorithm as Algorithm
  const algorithmLabel = ALGORITHM_LABELS[algorithm] ?? run.algorithm
  const status = STATUS_META[run.status]
  const StatusIcon = status.icon
  const nonTerminal = run.status === 'QUEUED' || run.status === 'RUNNING'
  const rows = classifyHyperparams(run.algorithm, run.hyperparameters)
  // const seedUsed = seedConsumedBy(run.algorithm)
  const splitPct = splitPercentFromRun(run.splitSpec)
  const rmse = typeof run.metrics?.rmse === 'number' ? run.metrics.rmse : null

  return (
    <div className="space-y-3 text-[11px]">
      <div className="flex items-center gap-1.5">
        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${status.className}`} />
        <span className="font-medium text-foreground">{status.label}</span>
        {run.failureReason && (
          <span className="truncate text-muted-foreground">
            — {run.failureReason}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Field label="Algorithm" value={algorithmLabel} />
        <Field
          label="Target"
          value={run.targetY}
          hint={targetMismatch ? 'not in the current dataset' : undefined}
        />
        <Field
          label="Split"
          value={`Train ${splitPct}% · Test ${100 - splitPct}%`}
        />
        {/* <Field
          label="Seed"
          value={String(run.seed)}
          hint={seedUsed ? undefined : 'not used by this estimator'}
        /> */}
      </dl>

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Hyperparameters
        </p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">
            No hyperparameters recorded for this run.
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map(r => (
              <li
                key={r.key}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="flex items-center gap-1.5">
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
              </li>
            ))}
          </ul>
        )}
      </div>

      {run.status === 'SUCCEEDED' && rmse !== null && (
        <div className="flex items-center justify-between border-t border-border/50 pt-2">
          <span className="text-muted-foreground">RMSE</span>
          <span className="font-mono tabular-nums font-medium text-foreground">
            {METRIC_META.rmse.format(rmse)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 text-[10px] text-muted-foreground">
        <span title={run.imageDigest}>
          Image {shortDigest(run.imageDigest)}
        </span>
        {run.featureSpecKey && (
          <span className="truncate" title={run.featureSpecKey}>
            {run.featureSpecKey}
          </span>
        )}
      </div>

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
            Apply will still set it, but Start Training will reject it until
            Target variable is corrected.
          </span>
        </p>
      )}

      <Button
        size="sm"
        variant="outline"
        className="w-full cursor-pointer"
        disabled={nonTerminal}
        onClick={onApply}
      >
        Apply to Training Config
      </Button>
      {nonTerminal && (
        <p className="text-center text-[10px] text-muted-foreground">
          Available once this run finishes.
        </p>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">
        {value}
        {hint && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            ({hint})
          </span>
        )}
      </dd>
    </div>
  )
}
