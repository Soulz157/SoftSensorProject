'use client'

import { useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
} from 'lucide-react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  mpCandidateJobIdAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'
import { useCandidateJob } from '@/hooks/model/use-candidate-job'
import { classifyHyperparams } from '@/lib/run-params'
import {
  modeARows,
  modeAHasValidationSeries,
  modeAMetricLabel,
  modeBMarks,
  renderModeFor,
} from '@/lib/run-selection'
import { modelDraftCandidateJobService } from '@/services/model-draft'
import type { CandidateResult, ModelCandidateJob } from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

const STATUS_META: Record<
  CandidateResult['status'],
  { label: string; icon: typeof Clock; className: string }
> = {
  PENDING: {
    label: 'Pending',
    icon: Circle,
    className: 'text-muted-foreground',
  },
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
    icon: AlertTriangle,
    className: 'text-muted-foreground',
  },
}

/**
 * MODEL-FLOW-013-T07. Two honest render modes — never one faked into the
 * other. Mode A (a real per-iteration curve) plots `train`, and only when
 * present a second line explicitly labelled "Test split" (never
 * "validation" — MODEL-FLOW-004's own finding on this exact misnomer).
 * Mode B (no curve exists) shows train/test RMSE as two paired marks, never
 * connected by a line — a two-point line is visually indistinguishable
 * from a real curve to a reader.
 */
function CandidateChart({ candidate }: { candidate: CandidateResult }) {
  if (renderModeFor(candidate) === 'A') {
    const rows = modeARows(candidate)
    const hasValidation = modeAHasValidationSeries(candidate)
    const metricLabel = modeAMetricLabel(candidate)
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Train
          </span>
          {hasValidation && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Test
              split
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart
            data={rows}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
          >
            <XAxis
              dataKey="iteration"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={32}
              label={{
                value: metricLabel,
                angle: -90,
                position: 'insideLeft',
                fontSize: 10,
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value: unknown) =>
                typeof value === 'number' ? value.toFixed(4) : String(value)
              }
            />
            <Line
              type="monotone"
              dataKey="train"
              stroke="var(--primary)"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            {hasValidation && (
              <Line
                type="monotone"
                dataKey="validation"
                stroke="#0ea5e9"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Mode B — no real trajectory for this algorithm. Paired marks, no line.
  const marks = modeBMarks(candidate)
  const max = Math.max(0.0001, ...marks.map(m => m.rmse ?? 0))
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">
        No iteration-by-iteration curve for this algorithm — train vs. test
        RMSE, as two points.
      </p>
      <div className="flex items-end gap-4 pt-1">
        {marks.map(mark => (
          <div
            key={mark.label}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <span className="font-mono text-xs tabular-nums text-foreground">
              {mark.rmse !== null ? mark.rmse.toFixed(3) : '—'}
            </span>
            <div className="flex h-16 w-6 items-end rounded-sm bg-muted/60">
              {mark.rmse !== null && (
                <div
                  className={cn(
                    'w-full rounded-sm',
                    mark.label === 'Train' ? 'bg-primary' : 'bg-sky-500',
                  )}
                  style={{ height: `${(mark.rmse / max) * 100}%` }}
                />
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {mark.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CandidateHyperparams({ candidate }: { candidate: CandidateResult }) {
  const rows = classifyHyperparams(
    candidate.algorithm,
    candidate.hyperparameters,
  )
  if (rows.length === 0) return null
  return (
    <p className="truncate text-[10px] text-muted-foreground">
      {rows.map(r => `${r.label}: ${String(r.value)}`).join(' · ')}
    </p>
  )
}

function CandidateRow({
  candidate,
  isSelected,
  onSelect,
  selecting,
}: {
  candidate: CandidateResult
  isSelected: boolean
  onSelect: () => void
  selecting: boolean
}) {
  const algorithmLabel =
    ALGORITHM_LABELS[candidate.algorithm as Algorithm] ?? candidate.algorithm
  const status = STATUS_META[candidate.status]
  const StatusIcon = status.icon

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        isSelected
          ? 'border-primary ring-1 ring-primary/40'
          : 'border-border/60',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn('h-3.5 w-3.5 shrink-0', status.className)}
            />
            <span className="text-sm font-medium text-foreground">
              {algorithmLabel}
            </span>
            {isSelected && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                Selected
              </Badge>
            )}
          </div>
          <CandidateHyperparams candidate={candidate} />
          {candidate.failureReason && (
            <p className="text-[11px] text-red-500">
              {candidate.failureReason}
            </p>
          )}
        </div>
        {candidate.status === 'SUCCEEDED' &&
          candidate.metrics?.rmse !== null && (
            <div className="text-right">
              <p className="font-mono text-sm tabular-nums text-foreground">
                {candidate.metrics?.rmse?.toFixed(3)}
              </p>
              <p className="text-[10px] text-muted-foreground">Test RMSE</p>
            </div>
          )}
      </div>

      {candidate.status === 'SUCCEEDED' && (
        <CandidateChart candidate={candidate} />
      )}

      {candidate.status === 'SUCCEEDED' && !isSelected && (
        <Button
          size="sm"
          variant="outline"
          className="w-full cursor-pointer"
          disabled={selecting}
          onClick={onSelect}
        >
          Select
        </Button>
      )}
    </div>
  )
}

function resolvedRunIdFor(job: ModelCandidateJob): string | null {
  return job.selectedRunId ?? job.bestRunId
}

function CandidateComparison({
  draftId,
  jobId,
}: {
  draftId: string
  jobId: string
}) {
  const { job, loading, error, refetch } = useCandidateJob(draftId, jobId)
  const [selecting, setSelecting] = useState(false)
  const [selectError, setSelectError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error || !job) {
    return (
      <EmptyPanel>
        Could not load the candidate comparison{error ? ` — ${error}` : ''}.
      </EmptyPanel>
    )
  }

  const nonTerminal = job.status === 'QUEUED' || job.status === 'RUNNING'
  if (nonTerminal) {
    return (
      <EmptyPanel>
        Sweep is still running — {job.completedRuns} of {job.totalRuns}{' '}
        candidates finished.
      </EmptyPanel>
    )
  }

  const resolvedRunId = resolvedRunIdFor(job)

  const handleSelect = async (runId: string) => {
    setSelecting(true)
    setSelectError(null)
    try {
      await modelDraftCandidateJobService.select(draftId, jobId, runId)
      refetch()
    } catch (err) {
      setSelectError(
        err instanceof Error ? err.message : 'Could not record that selection.',
      )
    } finally {
      setSelecting(false)
    }
  }

  return (
    <div className="space-y-4">
      {job.status === 'FAILED' && (
        <EmptyPanel>
          Sweep failed{job.failureReason ? ` — ${job.failureReason}` : '.'}{' '}
          Candidates that did finish are still shown below.
        </EmptyPanel>
      )}
      {selectError && <p className="text-xs text-red-500">{selectError}</p>}
      <CandidateGroups
        candidates={job.candidates}
        resolvedRunId={resolvedRunId}
        selecting={selecting}
        onSelect={runId => void handleSelect(runId)}
      />
    </div>
  )
}

/**
 * MODEL-FLOW-013-T11. A SWEEP_THEN_TUNE job's candidates carry a `phase` —
 * 1 (the sweep) or 2 (tuning phase 1's winner, appended server-side once
 * phase 1 exhausts). Grouped into two headed sections ONLY once a phase-2
 * group actually exists; an ALGORITHM_SWEEP job (no `phase: 2` candidate
 * ever) or a SWEEP_THEN_TUNE job still mid-phase-1 renders the exact same
 * flat, unheaded grid it always has — no empty "Tuning" header.
 */
function CandidateGroups({
  candidates,
  resolvedRunId,
  selecting,
  onSelect,
}: {
  candidates: CandidateResult[]
  resolvedRunId: string | null
  selecting: boolean
  onSelect: (runId: string) => void
}) {
  const phase1 = candidates.filter(c => c.phase !== 2)
  const phase2 = candidates.filter(c => c.phase === 2)
  const tunedAlgorithm = phase2[0]?.algorithm
  const tunedLabel = tunedAlgorithm
    ? (ALGORITHM_LABELS[tunedAlgorithm as Algorithm] ?? tunedAlgorithm)
    : null

  const grid = (group: CandidateResult[]) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {group.map(candidate => (
        <CandidateRow
          key={`${candidate.algorithm}-${candidate.phase}-${candidate.runId ?? 'pending'}`}
          candidate={candidate}
          isSelected={candidate.runId === resolvedRunId}
          selecting={selecting}
          onSelect={() => candidate.runId && onSelect(candidate.runId)}
        />
      ))}
    </div>
  )

  if (phase2.length === 0) return grid(phase1)

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground">Sweep</p>
      {grid(phase1)}
      <p className="text-xs font-medium text-muted-foreground">
        Tuning {tunedLabel}
      </p>
      {grid(phase2)}
    </div>
  )
}

/**
 * MODEL-FLOW-013 — Model Selection. Compares each candidate an algorithm
 * sweep trained (Step 3's "Find Best Model") and lets the user pick which
 * one carries forward, or accept the metric's own answer. `mpCandidateJobIdAtom`
 * being null means an ordinary single-run launch (no sweep) — an honest
 * pass-through, no comparison table, matching the acceptance criterion that
 * a draft with a single run must not stall here.
 */
export function Phase4ModelSelection({ nav }: Props) {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const candidateJobId = useAtomValue(mpCandidateJobIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  if (!trainingResult) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          No training run yet — start training in Step 3 to see it here.
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            Go to Training Configuration
          </Button>
        </div>
      </div>
    )
  }

  if (!candidateJobId) {
    const algorithmLabel =
      ALGORITHM_LABELS[trainingResult.algorithm] ?? trainingResult.algorithm
    // MODEL-FLOW-016-T11. Render mode is a property of the RUN
    // (`cvFoldsKey`), never the algorithm name (MODEL-FLOW-013-T05a's
    // rule) — CV and Find Best Model are mutually exclusive, so this
    // pass-through is the only place a CV run's own summary renders.
    const isCv = trainingResult.cvFoldsKey !== null
    const rmse = trainingResult.metrics?.rmse
    const rmseMean = trainingResult.metrics?.cv_rmse_mean
    const rmseStd = trainingResult.metrics?.cv_rmse_std
    const nSplits = trainingResult.metrics?.n_splits
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              {algorithmLabel} trained
            </p>
            <p className="text-xs text-muted-foreground">
              Only one candidate this run — nothing to compare. Continue to
              Evaluation.
              {!isCv && typeof rmse === 'number' && ` RMSE ${rmse.toFixed(3)}.`}
              {isCv &&
                typeof rmseMean === 'number' &&
                typeof rmseStd === 'number' &&
                ` RMSE ${rmseMean.toFixed(3)} ± ${rmseStd.toFixed(3)}` +
                  (typeof nSplits === 'number'
                    ? ` across ${nSplits} folds`
                    : '') +
                  '.'}
            </p>
            {/* Three numbers, three meanings, never merged: this is the fold
                mean — how much to trust the CONFIGURATION, not a score for
                the refit model that ships. That model's own honest number
                only exists once Evaluation's separate holdout-scoring phase
                runs (MODEL-FLOW-016-T07). */}
            {isCv && (
              <p className="text-[11px] text-muted-foreground">
                Mean ± std across folds — an estimate of the configuration, not
                the shipped model&apos;s own score. Score it against the holdout
                in Evaluation.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!draftId) {
    return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
  }

  return <CandidateComparison draftId={draftId} jobId={candidateJobId} />
}
