'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useTagListFetch } from '@/hooks/use-tag-list-fetch'
import { selectedTagsAtom } from '@/store/data-visualize'
import { TagDiscoveryCardList } from './tag-discovery-card-list'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

export function Step3TagRange({ nav }: Props) {
  const selectedTags = useAtomValue(selectedTagsAtom)
  const list = useTagListFetch()
  const started = useRef(false)

  useEffect(() => {
    if (started.current || list.tags.length > 0) return
    started.current = true
    list.start()
  }, [started, list])

  const toggleTag = (piTag: string) =>
    nav.setSelectedTags(
      selectedTags.includes(piTag)
        ? selectedTags.filter(t => t !== piTag)
        : [...selectedTags, piTag],
    )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Available tags</p>
          <p className="text-xs text-muted-foreground">
            Select the tags you want to retrieve data for.
          </p>
        </div>
      </div>

      <TagDiscoveryCardList
        tags={list.tags}
        selected={selectedTags}
        onToggle={toggleTag}
      />

      {list.status === 'done' && selectedTags.length === 0 && (
        <Alert>
          <AlertDescription>
            Select at least one tag to continue.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
