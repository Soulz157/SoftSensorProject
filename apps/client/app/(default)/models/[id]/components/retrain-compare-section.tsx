'use client'

import type { ReactNode } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatMetricValue } from '@/lib/model-evaluation'
import type { ComparisonView } from '@/lib/retrain'
import {
  CURRENT_USED_FOR,
  describeCurrentBasis,
  describeEvalBasis,
  describeTrainingComposition,
  describeUsedFor,
} from '@/lib/retrain-basis'
import { compareMetric } from '@/lib/retrain-metric-compare'
import type { ModelVersionNumber } from '@/lib/model-version-number'
import { BasisLabEvents, type LabEventIds } from './basis-lab-events'
import { RetrainEventMetricGrid } from './retrain-event-metric-grid'
import {
  RetrainMetricCompareCard,
  versionColumnLabel,
} from './retrain-metric-compare-card'
import { RetrainPairedEvents } from './retrain-paired-events'
import { RetrainCvGap } from './retrain-cv-gap'
import { RetrainAttribution } from './retrain-attribution'
import { RetrainCriteriaVerdicts } from './retrain-criteria'
import type { RetrainCriterion } from '@/lib/acceptance-criteria'
import { pairableOnSharedWindow } from '@/lib/retrain-lab-events'

const METRICS: { key: 'rmse' | 'r2' | 'mae'; label: string }[] = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'r2', label: 'R²' },
  { key: 'mae', label: 'MAE' },
]

/**
 * MODEL-SERVE-020-T03. Section 1 of the Retrain tab: the new version set
 * against the current one. Relocated VERBATIM from `retrain-progress.tsx`
 * (MODEL-SERVE-014/015/019) — no logic, copy or data-source changes; the
 * only new thing is that it now owns the explicit Apply-to-Production
 * decision and the RMSE delta, which used to sit below the new-data panels
 * and now sit with the comparison they belong to.
 *
 * Every figure names its own data (MODEL-SERVE-019-D02): the candidate's
 * score, the current version's score, and the role each plays. No internal
 * vocabulary reaches the screen — the plain-language mapping lives in
 * `lib/retrain-basis.ts`.
 */
export function RetrainCompareSection({
  view,
  currentVersion,
  candidateVersion,
  promotable,
  onApplyToProduction,
  applying,
  labEventIds,
  cvFolds,
  currentSettingsRunId = null,
  acceptanceCriteria = null,
}: {
  /** MODEL-SERVE-026-T07. Criteria this job's operator chose; null = none. */
  acceptanceCriteria?: RetrainCriterion[] | null
  /** MODEL-SERVE-026-T06. Run of "B", the current settings refitted on the
   *  new data; null when it was not refitted. */
  currentSettingsRunId?: string | null
  view: ComparisonView
  /** MODEL-SERVE-026-T02. Absent = no lab-event counts rendered. */
  labEventIds?: LabEventIds
  /** MODEL-SERVE-026-T05. Folds this job asked for; null/absent = none. */
  cvFolds?: number | null
  currentVersion: number | null
  candidateVersion: number | null
  /** Non-null only when the candidate is a STAGING version that can be
   *  promoted (`promotableCandidateVersion`). */
  promotable: ModelVersionNumber | null
  onApplyToProduction?: (version: ModelVersionNumber) => void
  applying?: boolean
}) {
  const versionLabel = currentVersion !== null ? `v${currentVersion}` : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Comparison with the current version
        </p>
        {candidateVersion !== null && (
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
            v{candidateVersion} — STAGING
          </span>
        )}
      </div>

      {/* MODEL-SERVE-019-T04. The training-data line — states what was
          actually trained on, with real row counts, never just the strategy
          name. NEW_DATA_ONLY needs this MORE than AUGMENT_DATA does, not
          less: a candidate that dropped the current version's training rows
          is the one whose basis a reader is most likely to misread.

          MODEL-SERVE-021 splits the second sentence by strategy: AUGMENT_DATA
          still carves a frozen slice of the current version's own test rows,
          so "compared against current v{n}'s own test data" stays true.
          NEW_DATA_ONLY replaces the training data outright and carves none —
          both versions are scored on the shared validation window instead,
          and saying "current version's own test data" here would describe a
          slice that no longer exists for this strategy. */}
      {view.strategy === 'AUGMENT_DATA' && (
        <p className="text-xs text-muted-foreground">
          {describeTrainingComposition(
            view.strategy,
            view.trainingComposition,
            'the new dataset',
          ) ?? 'Built from: existing + new dataset'}
          . Compared against{' '}
          <span className="font-medium text-foreground">
            current v{currentVersion}&apos;s own test data
          </span>
          {view.evalSet?.kind !== 'FROZEN_INCUMBENT_TEST' &&
            ' (not yet scored on that set)'}
          .
        </p>
      )}
      {view.strategy === 'NEW_DATA_ONLY' && (
        <p className="text-xs text-muted-foreground">
          {describeTrainingComposition(
            view.strategy,
            view.trainingComposition,
            'the new dataset',
          ) ?? 'Built from: the new dataset only'}
          . Compared against{' '}
          <span className="font-medium text-foreground">
            current v{currentVersion} on the same validation window
          </span>
          {view.candidateMetricsBasis?.unavailableReason
            ? ` (${view.candidateMetricsBasis.unavailableReason})`
            : ''}
          .
        </p>
      )}

      {!view.comparable && view.reason && (
        <p className="text-xs text-muted-foreground">
          Not directly comparable to current v{currentVersion}: {view.reason}
        </p>
      )}

      {/* MODEL-SERVE-019-D02/T04 + AC3. Every metric panel names its own
          basis — range and row count — and which role it plays, for BOTH
          versions, paired in one block above the grid so the two can be
          read against each other (they used to sit above and below the
          grid). A candidate whose basis was never recorded (a job created
          before that feature) shows no row rather than a fabricated one;
          the current version's row is always present — buildComparison
          always resolves its basis. */}
      <div className="space-y-1 rounded-md border border-border bg-muted/10 p-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Scored on
        </p>
        {view.candidateMetricsBasis && (
          <BasisRow
            label={versionColumnLabel('New', candidateVersion)}
            description={
              <>
                {describeEvalBasis(view.candidateMetricsBasis, versionLabel)}
                {labEventIds && (
                  <BasisLabEvents
                    basis={view.candidateMetricsBasis}
                    role="candidate"
                    ids={labEventIds}
                  />
                )}
              </>
            }
            usedFor={describeUsedFor(view.candidateMetricsBasis.usedFor)}
          />
        )}
        <BasisRow
          label={versionColumnLabel('Current', currentVersion)}
          description={
            <>
              {describeCurrentBasis(view.incumbentMetricsBasis, versionLabel)}
              {labEventIds && (
                <BasisLabEvents
                  basis={view.incumbentMetricsBasis}
                  role="incumbent"
                  ids={labEventIds}
                />
              )}
            </>
          }
          usedFor={CURRENT_USED_FOR}
        />
      </div>
      {/* MODEL-SERVE-026-T03. With ids, the lab-event figure leads and the
          all-row figure sits beneath it, labelled; without, today's grid. */}
      {labEventIds ? (
        <>
          <RetrainEventMetricGrid
            view={view}
            currentVersion={currentVersion}
            candidateVersion={candidateVersion}
            ids={labEventIds}
          />
          {/* MODEL-SERVE-026-T04. Only where both versions were scored on
              the same rows — anywhere else a pairing would be fiction. */}
          {pairableOnSharedWindow(view) && (
            <RetrainPairedEvents
              ids={labEventIds}
              currentVersion={currentVersion}
            />
          )}
          {/* MODEL-SERVE-026-T07. Only the criteria chosen for this job. */}
          {acceptanceCriteria && acceptanceCriteria.length > 0 && (
            <RetrainCriteriaVerdicts
              modelId={labEventIds.modelId}
              candidateRunId={labEventIds.candidateRunId}
              criteria={acceptanceCriteria}
            />
          )}
          {/* MODEL-SERVE-026-T06. Data vs settings — same shared window. */}
          {pairableOnSharedWindow(view) && (
            <RetrainAttribution
              modelId={labEventIds.modelId}
              chosenRunId={labEventIds.candidateRunId}
              currentSettingsRunId={currentSettingsRunId}
              currentVersion={currentVersion}
            />
          )}
          {/* MODEL-SERVE-026-T05. Only when this job asked for folds. */}
          {cvFolds ? (
            <RetrainCvGap
              modelId={labEventIds.modelId}
              runId={labEventIds.candidateRunId}
              currentVersion={currentVersion}
            />
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {METRICS.map(({ key, label }) => (
            <RetrainMetricCompareCard
              key={key}
              label={label}
              newLabel={versionColumnLabel('New', candidateVersion)}
              currentLabel={versionColumnLabel('Current', currentVersion)}
              newValue={view.candidateMetrics[key]}
              currentValue={view.incumbentMetrics[key]}
              comparison={
                view.comparable
                  ? compareMetric(
                      key,
                      view.candidateMetrics[key],
                      view.incumbentMetrics[key],
                    )
                  : null
              }
            />
          ))}
        </div>
      )}

      {/* MODEL-SERVE-015-T04 / MODEL-SERVE-020. The new version's OWN test
          data over the combined (existing + new) data — the score that picks
          the best new version, so it sits beside the comparison it explains.
          It is NOT a result on new data: on the one real retrain measured, 911
          of its 935 rows were old and 24 were new. Kept out of the section
          about the new data for exactly that reason, and never folded into the
          grid above, which is what the delta below is computed from. */}
      {view.newRegimeMetrics && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/10 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {view.newRegimeMetricsBasis
              ? describeEvalBasis(view.newRegimeMetricsBasis, versionLabel)
              : 'Its own test data (existing + new)'}
            {view.newRegimeMetricsBasis && labEventIds && (
              <BasisLabEvents
                basis={view.newRegimeMetricsBasis}
                role="candidate"
                ids={labEventIds}
              />
            )}
          </p>
          {view.newRegimeMetricsBasis && (
            <p className="text-[10px] text-muted-foreground">
              {describeUsedFor(view.newRegimeMetricsBasis.usedFor)}
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {METRICS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-0.5">
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {formatMetricValue(view.newRegimeMetrics![key])}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.comparable && view.rmseDelta !== null && (
        <p className="text-xs text-muted-foreground">
          {labEventIds ? 'Over all rows, RMSE' : 'RMSE'}{' '}
          {view.rmseDelta < 0 ? 'improved' : 'regressed'} by{' '}
          <span className="font-medium text-foreground">
            {Math.abs(view.rmseDelta).toFixed(4)}
          </span>{' '}
          vs. current v{currentVersion}. This candidate was saved as STAGING —
          current v{currentVersion} stays in production until you apply it.
        </p>
      )}

      {/* MODEL-SERVE-014. The explicit decision — a retrain lands a STAGING
          version and stops, so putting v{candidateVersion} live is a separate
          act the operator takes, never a consequence of the job finishing.
          Promotion itself (including the r2-floor override path) is the SAME
          `useModelPromote` flow the page's own Promote button uses; this is
          a second entry point to it, not a second implementation. */}
      {promotable !== null && onApplyToProduction && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-3">
          <p className="text-[11px] text-muted-foreground">
            Keep current v{currentVersion} in production, or put v
            {candidateVersion} live.
          </p>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={applying}
            onClick={() => onApplyToProduction(promotable)}
          >
            <ArrowUpCircle className="h-4 w-4" />
            {applying
              ? 'Applying…'
              : `Apply v${candidateVersion} to Production`}
          </Button>
        </div>
      )}
    </div>
  )
}

/** One row of the "Scored on" block: a fixed-width version label, then
 *  what that version's figure was computed on and what it is used for. */
function BasisRow({
  label,
  description,
  usedFor,
}: {
  label: string
  description: ReactNode
  usedFor: string | null
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-[10px]">
      <p className="font-medium text-foreground">{label}</p>
      <div className="min-w-0 text-muted-foreground">
        <p>{description}</p>
        {usedFor && <p>{usedFor}</p>}
      </div>
    </div>
  )
}
