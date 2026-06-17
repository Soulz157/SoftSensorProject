'use client'

import { useAtomValue } from 'jotai'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { selectedTagsAtom, timeRangeAtom } from '@/store/data-visualize'
import { TagSelector } from './tag-selector'
import { TimeRangeToggle } from './time-range-toggle'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

export function Step3TagRange({ nav }: Props) {
  const selectedTags = useAtomValue(selectedTagsAtom)
  const range = useAtomValue(timeRangeAtom)

  const toggleTag = (piTag: string) =>
    nav.setSelectedTags(
      selectedTags.includes(piTag)
        ? selectedTags.filter(t => t !== piTag)
        : [...selectedTags, piTag],
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TagSelector selected={selectedTags} onToggle={toggleTag} />
        <TimeRangeToggle value={range} onChange={nav.setTimeRange} />
      </div>
      {selectedTags.length === 0 && (
        <Alert>
          <AlertDescription>
            Select at least one tag to continue.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
