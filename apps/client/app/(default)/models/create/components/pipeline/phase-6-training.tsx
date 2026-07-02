'use client'

import { useEffect } from 'react'
import { Cpu, Loader2, RotateCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useModelTraining } from '@/hooks/model/use-model-training'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase6Training({ nav }: Props) {
  const training = useModelTraining()
  const { status, progress, start } = training
  const { next } = nav

  // Kick off training on entry.
  useEffect(() => {
    if (status === 'idle') start()
  }, [status, start])

  // Auto-advance to Results when training completes.
  useEffect(() => {
    if (status === 'done') next()
  }, [status, next])

  if (status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Training failed</AlertTitle>
        <AlertDescription>{training.error}</AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={start}
        >
          <RotateCw className="mr-2 h-3.5 w-3.5" />
          Retry
        </Button>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-primary/10" />
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/10 motion-reduce:hidden" />
        <Cpu className="relative h-9 w-9 text-primary" />
      </div>

      <div className="space-y-1">
        <p className="flex items-center justify-center gap-2 text-lg font-semibold text-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:hidden" />
          Training Model…
        </p>
        <p className="text-sm text-muted-foreground">
          Fitting the soft-sensor model on the processed dataset. This
          won&apos;t take long.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-1.5">
        <Progress value={progress} />
        <p className="text-right font-mono text-xs text-muted-foreground">
          {progress}%
        </p>
      </div>
    </div>
  )
}
