'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useModelTagListFetch } from '@/hooks/model/use-model-tag-list-fetch'
import {
  mpSelectedTagsAtom,
  mpSavedDataSourcesAtom,
} from '@/store/model-pipeline'
import { TagDiscoveryCardList } from '@/app/(default)/data-visualize/components/tag-discovery-card-list'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { DataSourcePicker } from './data-source-picker'
import { CsvTagMapping } from './csv-tag-mapping'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase2DataTags({ nav }: Props) {
  const selectedTags = useAtomValue(mpSelectedTagsAtom)
  const savedSources = useAtomValue(mpSavedDataSourcesAtom)
  const list = useModelTagListFetch()
  const startedFor = useRef<string | null>(null)

  const selectedSource = savedSources.find(
    s => s.id === nav.selectedSavedSourceId,
  )
  const sourceSelected = !!selectedSource
  const isCsv = selectedSource?.type === 'csv'

  useEffect(() => {
    if (!sourceSelected) return
    if (startedFor.current === nav.selectedSavedSourceId) return
    startedFor.current = nav.selectedSavedSourceId
    list.start()
  }, [sourceSelected, nav.selectedSavedSourceId, list])

  const toggleTag = (piTag: string) =>
    nav.setSelectedTags(
      selectedTags.includes(piTag)
        ? selectedTags.filter(t => t !== piTag)
        : [...selectedTags, piTag],
    )

  return (
    <div className="space-y-6">
      <DataSourcePicker nav={nav} />

      {sourceSelected && (
        <div className="space-y-4 border-t border-border/60 pt-5">
          {isCsv && (
            <CsvTagMapping
              onTagsConfirmed={() => {}}
              editedTags={{}}
              removedTags={[]}
              insertedTags={[]}
              onInsertTag={() => {}}
              onRemoveInsertedTag={() => {}}
              onEditTag={() => {}}
              onRemoveTag={() => {}}
              onHasInvalidTagsChange={() => {}}
            />
          )}

          <div>
            <p className="text-sm font-medium text-foreground">
              Available tags
            </p>
            <p className="text-xs text-muted-foreground">
              Search and select the tags the model will use as inputs.
            </p>
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
      )}
    </div>
  )
}
