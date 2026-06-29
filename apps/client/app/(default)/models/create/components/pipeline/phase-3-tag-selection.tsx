'use client'

import { useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useModelTagListFetch } from '@/hooks/model/use-model-tag-list-fetch'
import {
  mpSelectedTagsAtom,
  mpTagInputMethodAtom,
  mpSavedDataSourcesAtom,
} from '@/store/model-pipeline'
import { TagDiscoveryCardList } from '@/app/(default)/data-visualize/components/tag-discovery-card-list'
import { CsvTagMapping } from './csv-tag-mapping'
import { DataSourcePicker } from './data-source-picker'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3TagSelection({ nav }: Props) {
  const selectedTags = useAtomValue(mpSelectedTagsAtom)
  const tagInputMethod = useAtomValue(mpTagInputMethodAtom)
  const savedSources = useAtomValue(mpSavedDataSourcesAtom)
  const isManual = tagInputMethod === 'csv' || tagInputMethod === 'text'

  const list = useModelTagListFetch()
  const startedFor = useRef<string | null>(null)

  // Direct path: auto-discover tags once per source.
  useEffect(() => {
    if (tagInputMethod !== 'direct') return
    if (!nav.selectedSavedSourceId) return
    if (startedFor.current === nav.selectedSavedSourceId) return
    startedFor.current = nav.selectedSavedSourceId
    list.start()
  }, [tagInputMethod, nav.selectedSavedSourceId, list])

  const toggleTag = (piTag: string) =>
    nav.setSelectedTags(
      selectedTags.includes(piTag)
        ? selectedTags.filter(t => t !== piTag)
        : [...selectedTags, piTag],
    )

  const selectedSource = savedSources.find(
    s => s.id === nav.selectedSavedSourceId,
  )

  // ── Direct path ──────────────────────────────────────────────────────────
  if (tagInputMethod === 'direct') {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">Verified Tags</p>
          <p className="text-xs text-muted-foreground">
            {selectedSource
              ? `Tags fetched directly from ${selectedSource.name}. Select the inputs your model will use.`
              : 'Select at least one tag to continue.'}
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
    )
  }

  if (!isManual) return null

  const hasSource = nav.selectedSavedSourceId !== ''

  return (
    <div className="space-y-5">
      {/* Part A — target source selection */}
      {!hasSource && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              Validate Against Source
            </p>
            <p className="text-xs text-muted-foreground">
              Choose the data source to compare your tags against.
            </p>
          </div>
          <DataSourcePicker
            nav={{ ...nav, setSelectedSavedSource: nav.setValidationSource }}
          />
        </div>
      )}

      {/* Part B — Compare & Map */}
      {hasSource && (
        <div className="space-y-4">
          {/* Source confirmation chip */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 ring-1 ring-primary/20">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <p className="text-xs font-medium text-primary">
                Validating against:{' '}
                <span className="font-semibold">
                  {selectedSource?.name ?? nav.selectedSavedSourceId}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={nav.clearValidationSource}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Change
            </button>
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">
              Compare &amp; Map Tags
            </p>
            <p className="text-xs text-muted-foreground">
              Your tags are validated against the source. Fix or remove invalid
              (red) rows to continue.
            </p>
          </div>

          <CsvTagMapping
            onTagsConfirmed={nav.setSelectedTags}
            editedTags={nav.editedTags}
            removedTags={nav.removedTags}
            insertedTags={nav.insertedTags}
            onEditTag={nav.setEditedTag}
            onRemoveTag={nav.removeTag}
            onHasInvalidTagsChange={nav.setHasInvalidTags}
            onInsertTag={nav.insertTag}
            onRemoveInsertedTag={nav.removeInsertedTag}
            sourceName={selectedSource?.name}
          />

          {nav.hasInvalidTags && (
            <Alert variant="destructive">
              <AlertDescription>
                Fix or remove all invalid tags (shown in red) to continue.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  )
}
