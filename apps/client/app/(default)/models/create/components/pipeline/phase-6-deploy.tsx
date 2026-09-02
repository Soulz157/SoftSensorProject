'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Loader2,
  Rocket,
  Save,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ALGORITHM_LABELS,
  mpModeAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import { useModelCommit } from '@/hooks/model/use-model-commit'
import {
  cvScoringPhaseOf,
  useDraftRunEvaluation,
} from '@/hooks/model/use-draft-run-evaluation'
import { useRefreshModels } from '@/hooks/use-all-models'
import { updateModel } from '@/services/model'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

/**
 * Save Model — the wizard's terminal step. Shows a read-only review of the
 * configured model and persists it via the shared commit.
 *
 * Two exits: Save Model, and Save & Deploy which follows the save with a
 * `deployStatus: 'running'` update on the row it just created. Deploy is a
 * SECOND write, never folded into the commit — the persistence boundary
 * (CLAUDE.md §13) stays exactly where it was, and a deploy that fails leaves a
 * saved model rather than an ambiguous half-failure.
 *
 * Still no retrain/drift guardrails here: `mpAutoRetrainAtom` and friends
 * survive in the store from the old 4-step flow but nothing persists them, so
 * rendering them would collect settings that go nowhere.
 */
export function Phase6Deploy({ nav }: Props) {
  const router = useRouter()
  const mode = useAtomValue(mpModeAtom)
  const commit = useModelCommit()
  const refreshModels = useRefreshModels()
  // MODEL-FLOW-016-T12. The SAME call Phase 5 makes, for the same reason: the
  // run row is the only place the CV facts live. `mpNSplitsAtom` is not an
  // option here — it is client-only by design and comes back `undefined`
  // after a draft resume (see its own doc), so keying this screen off it
  // would print a train/test split for exactly the runs that have none.
  // Edit mode has no draft, so the hook resolves to `run: null` and every
  // branch below falls back to today's behaviour.
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)
  const { run } = useDraftRunEvaluation(
    serverDraftId,
    trainingResult?.runId ?? null,
  )
  const isCvRun = Boolean(run?.cvFoldsKey)
  const unscoredCv = cvScoringPhaseOf(run) === 'awaiting-scoring'
  // Which action is in flight, so only the pressed button spins and the other
  // still reads as disabled rather than both claiming to be working.
  const [busy, setBusy] = useState<'save' | 'deploy' | null>(null)

  const {
    selectedDataset,
    targetVariables,
    algorithms,
    trainTestSplit,
    findBestModel,
    findBestParams,
  } = nav

  const savedLabel = mode === 'edit' ? 'Changes saved' : 'Model saved'

  /**
   * Save is the persistence boundary; deploying is a second, separate write on
   * the row Save just created. They are sequenced, never combined — if the
   * deploy call fails the model still EXISTS, so the failure is reported as
   * "saved but not deployed" and the user is still taken to the list. Telling
   * them the whole thing failed would invite a duplicate save.
   */
  const handleSave = async (deploy: boolean) => {
    setBusy(deploy ? 'deploy' : 'save')
    let modelId: string | null
    try {
      modelId = await commit()
    } catch (err) {
      // MODEL-FLOW-007. `saveDraftService` returns a specific reason (409
      // already saved, 422 no successful run, 400 name collision) — surface
      // it rather than one generic, wrongly-retryable message for every
      // failure. Falls back to the generic string only for a genuinely
      // unknown throw (e.g. a network error with no message).
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to save. Please try again.'
      toast.error(message)
      setBusy(null)
      return
    }

    if (deploy) {
      try {
        if (!modelId) throw new Error('No model id returned from save')
        await updateModel(modelId, { deployStatus: 'running' })
        toast.success(`${savedLabel} — deploying`)
      } catch {
        toast.warning(
          `${savedLabel}, but deployment could not be started. Start it from the models list.`,
        )
      }
    } else {
      toast.success(savedLabel)
    }

    refreshModels()
    router.push('/models/views')
  }

  const rows: { label: string; value: string }[] = [
    { label: 'Dataset', value: selectedDataset?.name ?? '—' },
    {
      label: 'Target variable(s)',
      value: targetVariables.length ? targetVariables.join(', ') : '—',
    },
    {
      label: 'Algorithms',
      value: algorithms.map(a => ALGORITHM_LABELS[a]).join(', ') || '—',
    },
    // MODEL-FLOW-016-T12. A CV run has no single train/test cut, so printing
    // one here would describe a split that never happened — the same
    // "looks like success" class this feature keeps naming. k comes from the
    // run's own cv_folds.json; if that has not loaded, the row still tells
    // the truth, just without the number.
    isCvRun
      ? {
          label: 'Validation',
          value: run?.cvFolds
            ? `Cross-validation — ${run.cvFolds.n_splits} expanding folds`
            : 'Cross-validation — expanding folds',
        }
      : {
          label: 'Train / Test split',
          value: `${trainTestSplit} / ${100 - trainTestSplit}`,
        },
    {
      label: 'Automated tuning',
      value: findBestModel
        ? findBestParams
          ? 'Find best model + parameters'
          : 'Find best model'
        : 'Off',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Save className="h-4 w-4 text-muted-foreground" />
          Save model
        </h2>
        <p className="text-xs text-muted-foreground">
          Review the configuration, then save — or save and start deploying in
          one step.
        </p>
      </div>

      <dl className="divide-y divide-border/60 overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {rows.map(r => (
          <div
            key={r.label}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="truncate text-sm font-medium text-foreground">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* MODEL-FLOW-016-T12. Saving is one-way for scoring: the phase is
          draft-scoped (assertDraftWritable refuses a SAVED draft), so a CV
          run saved unscored can never be scored afterward — it ships with
          fold metrics that describe the CONFIGURATION and no held-out number
          of its own, permanently. Stated here rather than blocked: scoring is
          an explicitly optional pre-save action, so this is the user's call
          to make with the consequence in front of them. Neutral, not amber —
          red/amber are reserved for workspace and plant status. */}
      {unscoredCv && (
        <div className="flex gap-3 rounded-xl bg-muted/50 px-4 py-3 ring-1 ring-foreground/10">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              This model comes from a cross-validation run that was never scored
              against the holdout. Its fold metrics describe the configuration,
              not this model, which has no held-out score of its own —{' '}
              <span className="font-medium text-foreground">
                scoring cannot be run after saving.
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nav.goTo(5)}
              disabled={busy !== null}
            >
              Back to Evaluation
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
        <Button
          variant="outline"
          onClick={() => handleSave(false)}
          disabled={busy !== null}
          className="gap-2"
        >
          {busy === 'save' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === 'edit' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {busy === 'save'
            ? 'Saving…'
            : mode === 'edit'
              ? 'Save Changes'
              : 'Save Model'}
        </Button>

        <Button
          onClick={() => handleSave(true)}
          disabled={busy !== null}
          className="gap-2"
        >
          {busy === 'deploy' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          {busy === 'deploy' ? 'Deploying…' : 'Save & Deploy'}
        </Button>
      </div>
    </div>
  )
}
