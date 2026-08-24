'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Rocket, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ALGORITHM_LABELS, mpModeAtom } from '@/store/model-pipeline'
import { useModelCommit } from '@/hooks/model/use-model-commit'
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
export function Phase4Deploy({ nav }: Props) {
  const router = useRouter()
  const mode = useAtomValue(mpModeAtom)
  const commit = useModelCommit()
  const refreshModels = useRefreshModels()
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
    } catch {
      toast.error('Failed to save. Please try again.')
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
    {
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
