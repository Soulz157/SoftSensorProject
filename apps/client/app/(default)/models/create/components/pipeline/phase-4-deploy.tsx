'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ALGORITHM_LABELS, mpModeAtom } from '@/store/model-pipeline'
import { useModelCommit } from '@/hooks/model/use-model-commit'
import { useRefreshModels } from '@/hooks/use-all-models'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

/**
 * Save Model (Step 4) — the wizard's terminal step. Shows a read-only review of
 * the configured model and persists it via the shared commit. Deployment is
 * handled separately (outside this wizard), so no deploy guardrails here.
 */
export function Phase4Deploy({ nav }: Props) {
  const router = useRouter()
  const mode = useAtomValue(mpModeAtom)
  const commit = useModelCommit()
  const refreshModels = useRefreshModels()
  const [saving, setSaving] = useState(false)

  const {
    selectedDataset,
    targetVariables,
    algorithms,
    trainTestSplit,
    findBestModel,
    findBestParams,
  } = nav

  const handleSave = async () => {
    setSaving(true)
    try {
      await commit()
      refreshModels()
      toast.success(mode === 'edit' ? 'Changes saved' : 'Model saved')
      router.push('/models/views')
    } catch {
      toast.error('Failed to save. Please try again.')
      setSaving(false)
    }
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
        <h2 className="text-sm font-medium text-foreground">Save model</h2>
        <p className="text-xs text-muted-foreground">
          Review the configuration and save. Deployment is managed separately.
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

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === 'edit' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Save Model'}
        </Button>
      </div>
    </div>
  )
}
