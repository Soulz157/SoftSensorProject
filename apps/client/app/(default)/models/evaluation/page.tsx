'use client'

import { useEffect, useState } from 'react'
import { Box, LineChart } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAllModels } from '@/hooks/use-all-models'
import { ModelEvaluation } from './components/model-evaluation'

export default function ModelEvaluationPage() {
  const { models, loading } = useAllModels()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const first = models?.[0]
    if (!selectedId && first) {
      setSelectedId(first.id)
    }
  }, [models, selectedId])

  const selected = models?.find(m => m.id === selectedId) ?? null

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
              <LineChart className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Model Evaluation
              </h1>
              <p className="text-sm text-muted-foreground">
                AI analysis of predictions vs laboratory data
              </p>
            </div>
          </div>

          {models && models.length > 0 && (
            <Select
              value={selectedId ?? undefined}
              onValueChange={setSelectedId}
            >
              <SelectTrigger className="h-9 w-64">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {m.workspaceName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-lg" />
          </div>
        ) : selected ? (
          <ModelEvaluation model={selected} />
        ) : (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
            <Box className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">No models to evaluate</p>
            <p className="text-sm">
              Create a model first to run an evaluation.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
