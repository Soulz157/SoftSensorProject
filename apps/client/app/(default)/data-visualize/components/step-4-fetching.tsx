'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { RotateCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useDatasetFetch } from '@/hooks/use-dataset-fetch'
import { selectedTagsAtom, timeRangeAtom } from '@/store/data-visualize'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

export function Step4Fetching({ nav }: Props) {
  const selectedTags = useAtomValue(selectedTagsAtom)
  const range = useAtomValue(timeRangeAtom)
  const fetch = useDatasetFetch()
  const startedFor = useRef('')

  useEffect(() => {
    const key = `${selectedTags.join(',')}|${range}`
    if (startedFor.current === key) return
    startedFor.current = key
    fetch.start(selectedTags, range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTags, range])

  if (fetch.status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t fetch sensor data</AlertTitle>
        <AlertDescription>{fetch.error}</AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={() => fetch.retry(selectedTags, range)}
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </Alert>
    )
  }

  if (fetch.status === 'done' && nav.canAdvance(4) === false) {
    return (
      <Alert>
        <AlertTitle>No data in range</AlertTitle>
        <AlertDescription>
          Try extending the time range, or pick different tags.
        </AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={() => nav.goTo(3)}
        >
          Back to tags &amp; range
        </Button>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fetching {selectedTags.length} tag{selectedTags.length === 1 ? '' : 's'}{' '}
        over {range}…
      </p>
      <Progress value={fetch.progress} />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}
