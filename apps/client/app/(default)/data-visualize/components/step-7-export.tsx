'use client'

import { useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAllModels } from '@/hooks/use-all-models'
import { effectiveProdStatus } from '@/lib/model-status'
import { preprocess, toModelReady } from '@/lib/preprocessing'
import {
  rawDatasetAtom,
  timeRangeAtom,
  fillStrategiesAtom,
  selectedModelIdAtom,
} from '@/store/data-visualize'
import { StepView } from './step-view'

export function Step7Export() {
  const raw = useAtomValue(rawDatasetAtom)
  const range = useAtomValue(timeRangeAtom)
  const strategies = useAtomValue(fillStrategiesAtom)
  const [selectedModelId, setSelectedModelId] = useAtom(selectedModelIdAtom)
  const { models, loading } = useAllModels()

  const modelReady = useMemo(
    () => toModelReady(preprocess(raw, strategies)),
    [raw, strategies],
  )

  const selectedModel = models?.find(m => m.id === selectedModelId)
  const selectedOffline =
    !!selectedModel && effectiveProdStatus(selectedModel) === 'offline'

  const handleExport = () => {
    if (!selectedModel || selectedOffline) return
    toast.success(
      `Exported ${modelReady.rows.length} rows to ${selectedModel.name}`,
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {loading ? (
          <Skeleton className="h-9 w-56" />
        ) : (
          <Select value={selectedModelId} onValueChange={setSelectedModelId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {(models ?? []).map(m => {
                const offline = effectiveProdStatus(m) === 'offline'
                return (
                  <SelectItem key={m.id} value={m.id} disabled={offline}>
                    {m.name}
                    {offline ? ' (offline)' : ''}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        )}
        <Button
          onClick={handleExport}
          disabled={!selectedModel || selectedOffline}
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>

      {selectedOffline && (
        <Alert>
          <AlertDescription>
            This model is offline — choose another or wait for it to come back.
          </AlertDescription>
        </Alert>
      )}

      <StepView
        dataset={modelReady}
        range={range}
        summary={`${modelReady.rows.length} rows × ${modelReady.tags.length} features · normalized [0, 1]`}
      />
    </div>
  )
}
