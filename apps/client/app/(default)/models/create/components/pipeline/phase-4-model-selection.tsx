'use client'

import { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  AlertTriangle,
  ArrowRight,
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
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
  ALGORITHM_LABELS,
  type Algorithm,
  type DraftTrainingResult,
} from '@/store/model-pipeline'
import { useCandidateJob } from '@/hooks/model/use-candidate-job'
import { useCandidatePredictions } from '@/hooks/model/use-candidate-predictions'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useDraftSelection } from '@/hooks/model/use-draft-selection'
import { cvScoringPhaseOf } from '@/hooks/model/use-draft-run-evaluation'
import { classifyHyperparams } from '@/lib/run-params'
import {
  modeARows,
  modeAHasValidationSeries,
  modeAMetricLabel,
  modeBMarks,
  renderModeFor,
} from '@/lib/run-selection'
import {
  modelDraftCandidateJobService,
  modelDraftService,
} from '@/services/model-draft'
import type {
  CandidateResult,
  ModelCandidateJob,
  ModelTrainingRunListItem,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { CandidateBaseChart } from './model-selection/candidate-base-chart'
import { CandidateOverlayChart } from './model-selection/candidate-overlay-chart'

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
        <p className="text-[10px] font-medium text-muted-foreground">
          Did it converge?
        </p>
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
      <p className="text-[10px] font-medium text-muted-foreground">
        Did it converge?
      </p>
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
  predictionsItem,
  predictionsLoading,
}: {
  candidate: CandidateResult
  isSelected: boolean
  onSelect: () => void
  selecting: boolean
  predictionsItem: RunPredictionsBatchItem | undefined
  predictionsLoading: boolean
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
        <div className="space-y-3">
          <CandidateBaseChart
            runId={candidate.runId}
            item={predictionsItem}
            loading={predictionsLoading}
          />
          <CandidateChart candidate={candidate} />
        </div>
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

  // MODEL-FLOW-017-T03. Every terminal candidate's own runId, in one batch
  // request — a candidate not yet SUCCEEDED (no runId) contributes nothing
  // to fetch, not an error (CandidateBaseChart's own `!runId` early return
  // covers it). `job?.candidates` is a fresh array reference per fetch, not
  // per render, since it comes straight off `useCandidateJob`'s own state.
  const candidateRunIds = useMemo(
    () =>
      job?.candidates
        .map(c => c.runId)
        .filter((id): id is string => id !== null) ?? [],
    [job],
  )
  const { byRunId, loading: predictionsLoading } = useCandidatePredictions(
    draftId,
    candidateRunIds,
  )

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
        byRunId={byRunId}
        predictionsLoading={predictionsLoading}
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
  byRunId,
  predictionsLoading,
}: {
  candidates: CandidateResult[]
  resolvedRunId: string | null
  selecting: boolean
  onSelect: (runId: string) => void
  byRunId: Map<string, RunPredictionsBatchItem>
  predictionsLoading: boolean
}) {
  const phase1 = candidates.filter(c => c.phase !== 2)
  const phase2 = candidates.filter(c => c.phase === 2)
  const tunedAlgorithm = phase2[0]?.algorithm
  const tunedLabel = tunedAlgorithm
    ? (ALGORITHM_LABELS[tunedAlgorithm as Algorithm] ?? tunedAlgorithm)
    : null

  const section = (group: CandidateResult[]) => (
    <div className="space-y-4">
      <CandidateOverlayChart candidates={group} byRunId={byRunId} />
      <div className="grid gap-4 sm:grid-cols-2">
        {group.map(candidate => (
          <CandidateRow
            key={`${candidate.algorithm}-${candidate.phase}-${candidate.runId ?? 'pending'}`}
            candidate={candidate}
            isSelected={candidate.runId === resolvedRunId}
            selecting={selecting}
            onSelect={() => candidate.runId && onSelect(candidate.runId)}
            predictionsItem={
              candidate.runId ? byRunId.get(candidate.runId) : undefined
            }
            predictionsLoading={predictionsLoading}
          />
        ))}
      </div>
    </div>
  )

  if (phase2.length === 0) return section(phase1)

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground">Sweep</p>
      {section(phase1)}
      <p className="text-xs font-medium text-muted-foreground">
        Tuning {tunedLabel}
      </p>
      {section(phase2)}
    </div>
  )
}

/**
 * The ORIGINAL pass-through (MODEL-FLOW-016-T11) — a draft with only one
 * selectable run must not stall on a comparison table (MODEL-FLOW-013's own
 * acceptance criterion, restated by MODEL-FLOW-018-T04). Sourced from
 * `mpTrainingResultAtom`, a client-side cache of the run that just finished
 * training in THIS session — not a wizard form value, so MODEL-FLOW-012 AC1
 * (no current-form value rendered as a past run's own) does not apply to it
 * the way it would to Step 3's own atoms.
 *
 * MODEL-FLOW-018-T06 (advisor-found gap, 2026-09-04): `cvScoringPhase` /
 * `holdoutRmse` are optional because `DraftTrainingResult` carries no
 * `predictionsKey`/`scoringContainerId` — only the caller with the FULL run
 * row (`StandaloneSelection`'s own `selectedRun`) can know them. `undefined`
 * means exactly what it always meant before this task: the just-trained-
 * this-session fallback path, where scoring cannot yet have happened by
 * construction (it is a separate, later, user-triggered phase reachable only
 * from a resolved run in Evaluation) — same render as before. Without this,
 * a round trip (Step 4 -> Evaluation -> score -> back to Step 4) left this
 * component telling the user to do what they had just done, beside the fold
 * mean instead of `StandaloneRunRow`'s own honest `Holdout RMSE` — the same
 * category error in the same file, from two components disagreeing about one
 * run.
 */
function SingleRunSummary({
  trainingResult,
  cvScoringPhase,
  holdoutRmse,
}: {
  trainingResult: DraftTrainingResult
  cvScoringPhase?: 'awaiting-scoring' | 'scoring' | 'scored'
  holdoutRmse?: number | null
}) {
  const algorithmLabel =
    ALGORITHM_LABELS[trainingResult.algorithm] ?? trainingResult.algorithm
  // Render mode is a property of the RUN (`cvFoldsKey`), never the algorithm
  // name (MODEL-FLOW-013-T05a's rule) — CV and Find Best Model are mutually
  // exclusive, so this pass-through is the only place a CV run's own
  // summary renders.
  const isCv = trainingResult.cvFoldsKey !== null
  const phase = cvScoringPhase ?? 'awaiting-scoring'
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
              phase === 'scored' &&
              ` Holdout RMSE ${typeof holdoutRmse === 'number' ? holdoutRmse.toFixed(3) : '—'}.`}
            {isCv &&
              phase !== 'scored' &&
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
              (`holdoutRmse`, above) only exists once Evaluation's separate
              holdout-scoring phase runs (MODEL-FLOW-016-T07) — this note
              drops once it has, matching `StandaloneRunRow`'s own rule. */}
          {isCv && phase !== 'scored' && (
            <p className="text-[11px] text-muted-foreground">
              {phase === 'scoring'
                ? 'Scoring against the holdout is running — this refits nothing, it only scores the model already trained.'
                : "Mean ± std across folds — an estimate of the configuration, not the shipped model's own score. Score it against the holdout in Evaluation."}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const RUN_STATUS_META: Record<
  ModelTrainingRunListItem['status'],
  { icon: typeof Clock; className: string }
> = {
  QUEUED: { icon: Clock, className: 'text-muted-foreground' },
  RUNNING: { icon: Loader2, className: 'text-primary animate-spin' },
  SUCCEEDED: { icon: CheckCircle2, className: 'text-emerald-500' },
  FAILED: { icon: AlertTriangle, className: 'text-red-500' },
  // Same icon `STATUS_META` above already uses for CANCELED (this file's
  // own established convention for a candidate) — one icon per status,
  // not two, within this file.
  CANCELED: { icon: AlertTriangle, className: 'text-muted-foreground' },
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
 * MODEL-FLOW-018-T05. Reads a number field off an `unknown` value without
 * widening any shared type — see the doc comment on `splitShapeKey` below
 * for why this stays local instead of fixing `ModelRunSplitSpec`.
 */
function numberField(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const v = (value as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

/**
 * MODEL-FLOW-018-T05. CV-ness is keyed off `run.cvFoldsKey`, the SAME
 * signal `StandaloneRunRow`'s own metric column already trusts (`isCv`
 * above) — not off `splitSpec.method`. Advisor review (2026-09-04) caught
 * that keying this off `splitSpec` alone lets the two signals disagree: a
 * row could show "CV RMSE" (per `cvFoldsKey`) while this function called it
 * a plain chronological split (per `splitSpec`), silently dropping the
 * exact category-error note D2/finding-6 exist to surface. `splitSpec` is
 * now only the SECONDARY signal, read for `n_splits`/`ratio` detail once
 * `cvFoldsKey` has already decided CV vs. not.
 *
 * `n_splits` is read from `run.metrics` first (what `SingleRunSummary`
 * already trusts for this field), falling back to `splitSpec.n_splits`.
 *
 * `splitSpec.method` narrowed off `unknown`, not the client's own
 * `ModelRunSplitSpec` (services/model-draft.ts) — that interface only
 * declares 'chronological' | 'chronological_windowed', but a live CV run's
 * own splitSpec is `{ method: 'cv_expanding', n_splits }`
 * (model-run-launch.authorized.service.ts:184) with NO `ratio` at all.
 * Mirrors the backend's own `isPlainObject`-then-narrow pattern
 * (model-draft.authorized.service.ts's `extractCvConfig`) rather than
 * widening the shared type here — that type is also `splitPercentFromRun`'s
 * (lib/run-params.ts) own parameter, used unconditionally by RunParamsPanel
 * for EVERY run including CV ones. Recorded as its own ledger finding (not
 * fixed here — out of T05's scope): three separate workarounds across
 * T04/T05 now exist because of this one gap.
 */
function splitShapeKey(run: ModelTrainingRunListItem): string {
  if (run.cvFoldsKey !== null) {
    const n =
      numberField(run.metrics, 'n_splits') ??
      numberField(run.splitSpec, 'n_splits')
    return `cv:${n ?? '?'}`
  }
  const s = run.splitSpec
  const method = stringField(s, 'method') ?? 'unknown'
  const ratio = numberField(s, 'ratio')
  return `${method}:${ratio ?? '?'}`
}

function splitShapeLabel(run: ModelTrainingRunListItem): string {
  if (run.cvFoldsKey !== null) {
    const n =
      numberField(run.metrics, 'n_splits') ??
      numberField(run.splitSpec, 'n_splits')
    return n !== null ? `${n}-fold cross-validation` : 'cross-validation'
  }
  const s = run.splitSpec
  if (!s || typeof s !== 'object') return 'an unrecorded split'
  const method = stringField(s, 'method') ?? 'unknown'
  const ratio = numberField(s, 'ratio')
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const methodLabel =
    method === 'chronological_windowed'
      ? 'windowed chronological'
      : 'chronological'
  return pct !== null
    ? `a ${pct}/${100 - pct} ${methodLabel} split`
    : `a ${methodLabel} split`
}

/**
 * MODEL-FLOW-018-T05, per openDecision D2 (resolved 2026-09-03): a
 * DIFFERENT target is never sorted into the same column — that is handled
 * structurally, by grouping (below), not here. This is the SECOND half of
 * D2: differences that are legitimate but change what a number DESCRIBES
 * (dataset artifact, feature spec, split shape) do not block Select — they
 * are named on the row, one sentence, so the number is read correctly
 * rather than assumed comparable. Symmetric by construction: an axis is
 * named on EVERY row in the group when that axis isn't uniform across the
 * group, not diffed against one arbitrarily-chosen "reference" row — there
 * is no reason one row's shape is more canonical than another's.
 */
function comparabilityNote(
  run: ModelTrainingRunListItem,
  group: ModelTrainingRunListItem[],
): string | null {
  if (group.length <= 1) return null

  const parts: string[] = []
  if (group.some(r => r.goldArtifactId !== run.goldArtifactId)) {
    parts.push('a different dataset artifact')
  }
  if (group.some(r => r.featureSpecKey !== run.featureSpecKey)) {
    parts.push('a different feature spec')
  }
  if (group.some(r => splitShapeKey(r) !== splitShapeKey(run))) {
    parts.push(splitShapeLabel(run))
  }

  if (parts.length === 0) return null
  return `Not the same comparison as the other rows here — ${parts.join(', ')}.`
}

/**
 * MODEL-FLOW-018-T04. A standalone run's own row — a SEPARATE renderer from
 * `CandidateRow` above, deliberately: the task's own instruction is that
 * both shapes coexist and neither is flattened into the other's renderer.
 * `CandidateResult` and `ModelTrainingRunListItem` differ in exactly the
 * fields that matter here (no `phase`, a real `candidateJobId`, `cvFoldsKey`
 * for the CV-aware metric read below) — coercing one shape into the other's
 * component would either drop those fields or fake them.
 *
 * ROWS ARE NOT SORTED BY METRIC. `comparabilityNote` (MODEL-FLOW-018-T05,
 * computed by the caller and passed in) is how a differing dataset/feature-
 * spec/split shape is surfaced instead — sorting by RMSE would risk the
 * exact category error grouping-by-target exists to catch (two different
 * targets' RMSEs in one ordered column), so rows stay in the run list's own
 * server order (most-recent-first), same as RunParamsPanel.
 *
 * DISABLE REASONS ARE THE FIRST TWO OF MODEL-FLOW-018-T03's THREE — a
 * non-terminal run, and a FAILED/CANCELED one. The third (the run's own
 * candidate job still live) is not reproduced here: this branch is only
 * reached when `mpCandidateJobIdAtom` is null, i.e. there is no CURRENTLY
 * tracked live job to compare a run's `candidateJobId` against client-side.
 * `selectDraftRunService` still refuses it server-side regardless (the
 * authority for that check), and the refusal surfaces through `selectError`
 * below like any other refusal.
 */
function StandaloneRunRow({
  run,
  isSelected,
  selecting,
  comparabilityNote,
  onSelect,
}: {
  run: ModelTrainingRunListItem
  isSelected: boolean
  selecting: boolean
  comparabilityNote: string | null
  onSelect: () => void
}) {
  const algorithmLabel =
    ALGORITHM_LABELS[run.algorithm as Algorithm] ?? run.algorithm
  const status = RUN_STATUS_META[run.status]
  const StatusIcon = status.icon
  const nonTerminal = run.status === 'QUEUED' || run.status === 'RUNNING'
  const runFailed = run.status === 'FAILED' || run.status === 'CANCELED'
  const selectDisabledReason = nonTerminal
    ? 'Available once this run finishes.'
    : runFailed
      ? "This run didn't succeed — nothing to carry forward."
      : null

  // MODEL-FLOW-018-T06, per finding 6. Keyed off `cvFoldsKey`/
  // `cvScoringPhaseOf` (MODEL-FLOW-016-T11's own signals), never
  // `algorithm` — a membership list in the client is a second source of
  // truth that drifts, and it drifts toward showing an empty cell rather
  // than an honest one (MODEL-FLOW-013-T05a's rule). `cvScoringPhaseOf`
  // takes `DraftRunSummary`; built here from this row's own fields rather
  // than widened/cast past it — the one shape gap (`cvFolds` optional on a
  // list row, required there) carries no meaning for what the function
  // actually reads (`cvFoldsKey`/`predictionsKey`/`scoringContainerId`).
  const cvPhase = cvScoringPhaseOf({
    id: run.id,
    status: run.status,
    algorithm: run.algorithm,
    targetY: run.targetY,
    failureReason: run.failureReason,
    cvFoldsKey: run.cvFoldsKey,
    predictionsKey: run.predictionsKey,
    scoringContainerId: run.scoringContainerId,
    holdoutMetrics: run.holdoutMetrics,
    cvFolds: run.cvFolds ?? null,
  })

  // Three DIFFERENT quantities behind one column position, never blended:
  // a non-CV run's own test-split score; a CV run's fold-mean ESTIMATE of
  // the configuration, pre-scoring; a scored CV run's refit holdout score —
  // the shipped model's OWN number, from `holdoutMetrics`, never
  // `metrics.cv_rmse_mean` (the same category error MODEL-FLOW-016's
  // finding 3 already caught once in this wizard's Evaluation step). A
  // missing metric renders as an em dash, never 0 and never a value
  // computed client-side.
  const metricValue =
    cvPhase === 'scored'
      ? typeof run.holdoutMetrics?.rmse === 'number'
        ? run.holdoutMetrics.rmse.toFixed(3)
        : '—'
      : cvPhase === 'not-cv'
        ? typeof run.metrics?.rmse === 'number'
          ? run.metrics.rmse.toFixed(3)
          : '—'
        : typeof run.metrics?.cv_rmse_mean === 'number'
          ? `${run.metrics.cv_rmse_mean.toFixed(3)}${
              typeof run.metrics?.cv_rmse_std === 'number'
                ? ` ± ${run.metrics.cv_rmse_std.toFixed(3)}`
                : ''
            }`
          : '—'
  const metricLabel =
    cvPhase === 'scored'
      ? 'Holdout RMSE'
      : cvPhase === 'not-cv'
        ? 'Test RMSE'
        : 'Est. CV RMSE'

  // MODEL-FLOW-018-T03's own pattern (RunParamsPanel's footer CTA): raw
  // setters, not `nav.goTo()` — `StandaloneRunRow` sits three components
  // below `Phase4ModelSelection`'s own `nav` prop, and threading it through
  // two intermediate components that never use it themselves just to reach
  // this one leaf branch is the exact prop churn that pattern exists to
  // avoid. Gated on `isSelected`: `nav`-equivalent navigation to Evaluation
  // resolves whichever run `ModelDraft.selectedRunId` (or its fallback
  // chain) currently names — offering this action on a NON-selected row
  // would silently land on a DIFFERENT run's Evaluation, the exact
  // "whichever ran last" failure this whole feature exists to replace.
  const setCurrentStep = useSetAtom(mpCurrentStepAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        isSelected
          ? 'border-primary ring-1 ring-primary/40'
          : 'border-border/60',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
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
                Carrying forward
              </Badge>
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            y = {run.targetY} · {formatRunTimestamp(run.createdAt)}
          </p>
          {run.failureReason && (
            <p className="text-[11px] text-red-500">{run.failureReason}</p>
          )}
        </div>
        {run.status === 'SUCCEEDED' && (
          <div className="shrink-0 text-right">
            <p className="font-mono text-sm tabular-nums text-foreground">
              {metricValue}
            </p>
            <p className="text-[10px] text-muted-foreground">{metricLabel}</p>
          </div>
        )}
      </div>

      {comparabilityNote && (
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          {comparabilityNote}
        </p>
      )}

      {/* MODEL-FLOW-018-T06. The configuration's own estimate is not the
          shipped model's score — say so, same fact SingleRunSummary already
          states for the pre-comparison pass-through, worded to match. */}
      {(cvPhase === 'awaiting-scoring' || cvPhase === 'scoring') && (
        <div className="space-y-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <p>
            {cvPhase === 'scoring'
              ? 'Scoring against the holdout is running — this refits nothing, it only scores the model already trained.'
              : isSelected
                ? "An estimate of the configuration, not the shipped model's own score — score it against the holdout in Evaluation."
                : "An estimate of the configuration, not the shipped model's own score. Select it to score it against the holdout in Evaluation."}
          </p>
          {cvPhase === 'awaiting-scoring' && isSelected && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 cursor-pointer gap-1 px-2 text-[10px]"
              onClick={() => {
                setHighestUnlocked(prev => Math.max(prev, 5))
                setCurrentStep(5)
              }}
            >
              Score in Evaluation
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {selectDisabledReason && (
        <p className="text-[10px] text-muted-foreground">
          {selectDisabledReason}
        </p>
      )}

      {!isSelected && (
        <Button
          size="sm"
          variant="outline"
          className="w-full cursor-pointer"
          disabled={selecting || selectDisabledReason !== null}
          title={selectDisabledReason ?? undefined}
          onClick={onSelect}
        >
          Select
        </Button>
      )}
    </div>
  )
}

/**
 * MODEL-FLOW-018-T05, per openDecision D2. Two different targets never
 * share one comparison — grouped into SEPARATE sections, one grid each,
 * rather than one flat list a reader could scan as if RMSE meant the same
 * thing in every row. Insertion order (JS `Map`) matches the run list's own
 * server order, so a single-target draft — the common case — gets exactly
 * the same visual result as before this task: one ungrouped grid, no header
 * (a header naming the one target every row already repeats would be pure
 * noise).
 */
function groupByTarget(
  runs: ModelTrainingRunListItem[],
): [string, ModelTrainingRunListItem[]][] {
  const groups = new Map<string, ModelTrainingRunListItem[]>()
  for (const run of runs) {
    const group = groups.get(run.targetY)
    if (group) {
      group.push(run)
    } else {
      groups.set(run.targetY, [run])
    }
  }
  return Array.from(groups.entries())
}

/**
 * MODEL-FLOW-018-T04, extended by T05. The comparison table for runs no
 * ModelCandidateJob owns — sourced from `runs` (the draft's OWN run list,
 * passed down from `StandaloneSelection` below), never a job's candidates
 * array. Mirrors `CandidateComparison`'s shape (error/select-error handling,
 * refetch after select) without sharing its renderer, per T04's own
 * instruction. ROWS STILL ARE NOT SORTED BY METRIC — T05's own scope is
 * grouping and per-row labeling, not introducing a ranking that was never
 * requested; each group's rows stay in server order.
 */
function StandaloneComparison({
  draftId,
  runs,
  selectedRunId,
  refetchSelection,
}: {
  draftId: string
  runs: ModelTrainingRunListItem[]
  selectedRunId: string | null
  refetchSelection: () => void
}) {
  const [selectingRunId, setSelectingRunId] = useState<string | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)

  const handleSelect = async (runId: string) => {
    setSelectingRunId(runId)
    setSelectError(null)
    try {
      await modelDraftService.selectRun(draftId, runId)
      refetchSelection()
    } catch (err) {
      setSelectError(
        err instanceof Error ? err.message : 'Could not record that selection.',
      )
    } finally {
      setSelectingRunId(null)
    }
  }

  const groups = groupByTarget(runs)
  const multiTarget = groups.length > 1

  return (
    <div className="space-y-4">
      {selectError && <p className="text-xs text-red-500">{selectError}</p>}
      {groups.map(([targetY, groupRuns]) => (
        <div key={targetY} className="space-y-3">
          {multiTarget && (
            <p className="text-xs font-medium text-muted-foreground">
              y = {targetY}
            </p>
          )}
          <div
            className={cn(
              'grid gap-4',
              groupRuns.length > 1 && 'sm:grid-cols-2',
            )}
          >
            {groupRuns.map(run => (
              <StandaloneRunRow
                key={run.id}
                run={run}
                isSelected={run.id === selectedRunId}
                selecting={selectingRunId === run.id}
                comparabilityNote={comparabilityNote(run, groupRuns)}
                onSelect={() => void handleSelect(run.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * MODEL-FLOW-018-T04. Decides between the two standalone shapes: a single
 * selectable run still passes through via `SingleRunSummary`, and 2+
 * selectable runs — including two CV runs, which no sweep can ever group
 * (CV and Find Best Model are mutually exclusive) — get the comparison
 * table. Fetches the run list ONCE here and passes it down, rather than each
 * child fetching its own copy.
 *
 * MODEL-FLOW-018-T06 extends the single-run branch below with
 * `cvScoringPhase`/`holdoutRmse`, sourced from the same `selectedRun` this
 * branch already reads — see `SingleRunSummary`'s own doc comment.
 */
function StandaloneSelection({
  draftId,
  trainingResult,
}: {
  draftId: string
  trainingResult: DraftTrainingResult
}) {
  const { runs, loading, error } = useDraftRuns(draftId)
  const { selectedRunId, refetch: refetchSelection } =
    useDraftSelection(draftId)

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return <EmptyPanel>Could not load training runs — {error}</EmptyPanel>
  }

  // Gate on SELECTABLE runs (SUCCEEDED), not the raw row count — `runs`
  // includes QUEUED/RUNNING/FAILED/CANCELED rows too, and a draft with one
  // SUCCEEDED run plus one FAILED attempt has exactly one candidate to
  // compare, matching MODEL-FLOW-013's own acceptance criterion ("a single
  // run must not stall") by what it actually means: nothing to CHOOSE
  // between, not merely "more than one row exists." The table, once it
  // opens, still renders every row (including non-SUCCEEDED ones, named with
  // their own reason) — the count below decides ONLY whether it opens.
  const selectableCount = runs.filter(r => r.status === 'SUCCEEDED').length
  if (selectableCount <= 1) {
    // Prefer the run `selectedRunId` names, if one is set and present in
    // the list — `trainingResult` is this SESSION's last completed run,
    // which can disagree with an explicit selection made on a different
    // (also-terminal) run earlier. Defensive: `launchDraftRun` clears
    // `selectedRunId` on every new launch and the SUCCEEDED count can only
    // grow, so a mismatch should not be reachable in the normal flow — but
    // an incorrect summary here would silently misname what Save Model
    // actually adopts, so this is cheap insurance rather than an assumption.
    const selectedRun = runs.find(r => r.id === selectedRunId)
    const summarySource: DraftTrainingResult = selectedRun
      ? {
          runId: selectedRun.id,
          algorithm: selectedRun.algorithm as Algorithm,
          metrics: selectedRun.metrics,
          trainedAt: selectedRun.createdAt,
          cvFoldsKey: selectedRun.cvFoldsKey,
        }
      : trainingResult
    // MODEL-FLOW-018-T06 (advisor-found gap, 2026-09-04). Only knowable from
    // the FULL run row, never from the `trainingResult` fallback — see
    // `SingleRunSummary`'s own doc comment for why `undefined` there is
    // correct, not a missing case.
    const cvScoringPhase =
      selectedRun && selectedRun.cvFoldsKey !== null
        ? cvScoringPhaseOf({
            id: selectedRun.id,
            status: selectedRun.status,
            algorithm: selectedRun.algorithm,
            targetY: selectedRun.targetY,
            failureReason: selectedRun.failureReason,
            cvFoldsKey: selectedRun.cvFoldsKey,
            predictionsKey: selectedRun.predictionsKey,
            scoringContainerId: selectedRun.scoringContainerId,
            holdoutMetrics: selectedRun.holdoutMetrics,
            cvFolds: selectedRun.cvFolds ?? null,
          })
        : undefined
    const holdoutRmse =
      typeof selectedRun?.holdoutMetrics?.rmse === 'number'
        ? selectedRun.holdoutMetrics.rmse
        : null
    return (
      <SingleRunSummary
        trainingResult={summarySource}
        cvScoringPhase={
          cvScoringPhase === 'not-cv' ? undefined : cvScoringPhase
        }
        holdoutRmse={holdoutRmse}
      />
    )
  }

  return (
    <StandaloneComparison
      draftId={draftId}
      runs={runs}
      selectedRunId={selectedRunId}
      refetchSelection={refetchSelection}
    />
  )
}

/**
 * MODEL-FLOW-013, extended by MODEL-FLOW-018-T04. Compares each candidate an
 * algorithm sweep trained (Step 3's "Find Best Model") and lets the user
 * pick which one carries forward, or accept the metric's own answer.
 * `mpCandidateJobIdAtom` being null means there is no CURRENT sweep to show
 * via that path — it does NOT mean there is nothing to compare: a draft
 * whose runs were launched one at a time (including every CV run, which can
 * never belong to a sweep) now gets its own comparison
 * (`StandaloneSelection`), sourced from the draft's run list rather than a
 * job's candidates array. A draft with only one selectable run still passes
 * through honestly, no comparison table — MODEL-FLOW-013's own acceptance
 * criterion, unchanged by this feature.
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
    if (!draftId) {
      return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
    }
    return (
      <StandaloneSelection draftId={draftId} trainingResult={trainingResult} />
    )
  }

  if (!draftId) {
    return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
  }

  return <CandidateComparison draftId={draftId} jobId={candidateJobId} />
}
