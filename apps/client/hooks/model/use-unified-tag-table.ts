'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  mpCsvUploadTagsAtom,
  mpHasInvalidTagsAtom,
  mpSavedDataSourcesAtom,
  mpSelectedSavedSourceIdsAtom,
  mpSelectedTagsAtom,
  type SavedDataSource,
} from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

export interface UnifiedTagRow {
  id: string
  tagName: string
  originalName: string
  dataSource: string
  status: 'good' | 'error'
  errorReason?: string
}

// Phase 6 placeholder — same approved mock-data pattern as mock-readings.ts.
// Swap path: replace with real tag-discovery API response keyed by source id.
const SOURCE_MOCK_TAGS: Record<
  string,
  Array<{ tagName: string; status: 'good' | 'error'; errorReason?: string }>
> = {
  'ds-1': [
    { tagName: 'TI-101', status: 'good' },
    { tagName: 'PI-303', status: 'good' },
    {
      tagName: 'VI-202',
      status: 'error',
      errorReason: 'Tag not found in historian',
    },
    { tagName: 'FI-101', status: 'good' },
    { tagName: 'TI-205', status: 'error', errorReason: 'No data in last 24 h' },
    { tagName: 'ambient_temp_c', status: 'good' },
    {
      tagName: 'cooling_water_flow',
      status: 'error',
      errorReason: 'Tag deprecated — use CWF-NEW',
    },
  ],
  'ds-2': [
    { tagName: 'pump_speed', status: 'good' },
    { tagName: 'discharge_pressure', status: 'good' },
    {
      tagName: 'suction_pressure',
      status: 'error',
      errorReason: 'Column mapping failed',
    },
    { tagName: 'flow_rate', status: 'good' },
    { tagName: 'motor_current', status: 'good' },
    {
      tagName: 'vibration_rms',
      status: 'error',
      errorReason: 'Null values > 30%',
    },
  ],
  'ds-3': [
    { tagName: 'CMP-001.speed', status: 'good' },
    { tagName: 'CMP-001.inlet_temp', status: 'good' },
    { tagName: 'CMP-001.outlet_pressure', status: 'good' },
    {
      tagName: 'CMP-001.power_kw',
      status: 'error',
      errorReason: 'Connection timeout',
    },
    { tagName: 'CMP-002.speed', status: 'good' },
    { tagName: 'CMP-002.vibration', status: 'good' },
  ],
}

// User-added sources (random UUID) have no preset mock tags — synthesize a
// small deterministic set so the new connection shows up in the table.
// Phase 6 placeholder, same approved mock pattern as SOURCE_MOCK_TAGS above.
function defaultMockTags(
  source: SavedDataSource,
): Array<{ tagName: string; status: 'good' | 'error'; errorReason?: string }> {
  const base =
    source.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tag'
  return [
    { tagName: `${base}_signal_1`, status: 'good' },
    { tagName: `${base}_signal_2`, status: 'good' },
    { tagName: `${base}_signal_3`, status: 'good' },
  ]
}

export function useUnifiedTagTable(nav: UsePipelineNavResult) {
  const selectedSourceIds = useAtomValue(mpSelectedSavedSourceIdsAtom)
  const savedSources = useAtomValue(mpSavedDataSourcesAtom)
  const csvUploadTags = useAtomValue(mpCsvUploadTagsAtom)
  const removedTags = nav.removedTags
  const editedTags = nav.editedTags
  const insertedTags = nav.insertedTags

  // Write directly to atoms — bypass nav cascade (cascade is triggered upstream
  // when the user changes source selection in Step 2).
  const setSelectedTagsRaw = useSetAtom(mpSelectedTagsAtom)
  const setHasInvalidTagsRaw = useSetAtom(mpHasInvalidTagsAtom)

  const rows = useMemo((): UnifiedTagRow[] => {
    const result: UnifiedTagRow[] = []
    const seen = new Set<string>()

    // Tags from selected data sources
    for (const sourceId of selectedSourceIds) {
      const source = savedSources.find(s => s.id === sourceId)
      const sourceName = source?.name ?? sourceId
      const mockTags =
        SOURCE_MOCK_TAGS[sourceId] ?? (source ? defaultMockTags(source) : [])

      for (const mock of mockTags) {
        if (removedTags.includes(mock.tagName) || seen.has(mock.tagName))
          continue
        seen.add(mock.tagName)
        const tagName = editedTags[mock.tagName] ?? mock.tagName
        result.push({
          id: `${sourceId}::${mock.tagName}`,
          tagName,
          originalName: mock.tagName,
          dataSource: sourceName,
          status: mock.status,
          errorReason: mock.errorReason,
        })
      }
    }

    // Tags from Step 2 CSV upload
    for (const tag of csvUploadTags) {
      if (removedTags.includes(tag) || seen.has(tag)) continue
      seen.add(tag)
      const tagName = editedTags[tag] ?? tag
      result.push({
        id: `csv::${tag}`,
        tagName,
        originalName: tag,
        dataSource: 'CSV Upload',
        status: 'good',
      })
    }

    // Manually inserted tags (added in Step 3)
    for (const tag of insertedTags) {
      if (removedTags.includes(tag) || seen.has(tag)) continue
      seen.add(tag)
      const tagName = editedTags[tag] ?? tag
      result.push({
        id: `manual::${tag}`,
        tagName,
        originalName: tag,
        dataSource: 'Manual',
        status: 'good',
      })
    }

    return result
  }, [
    selectedSourceIds,
    savedSources,
    csvUploadTags,
    removedTags,
    editedTags,
    insertedTags,
  ])

  // Sync derived tag list + error flag to store without triggering the nav cascade.
  useEffect(() => {
    const goodTags = rows.filter(r => r.status === 'good').map(r => r.tagName)
    const hasErrors = rows.some(r => r.status === 'error')
    setSelectedTagsRaw(goodTags)
    setHasInvalidTagsRaw(hasErrors)
  }, [rows, setSelectedTagsRaw, setHasInvalidTagsRaw])

  const addRow = useCallback((): string => {
    const placeholder = `new-tag-${Date.now()}`
    nav.insertTag(placeholder)
    return `manual::${placeholder}`
  }, [nav])

  const deleteRow = useCallback(
    (row: UnifiedTagRow) => {
      nav.setTagConstant(row.tagName, null)
      if (row.dataSource === 'Manual' || row.dataSource === 'CSV Upload') {
        nav.removeInsertedTag(row.originalName)
      } else {
        nav.removeTag(row.originalName)
      }
    },
    [nav],
  )

  const renameRow = useCallback(
    (row: UnifiedTagRow, newName: string) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === row.originalName) return
      if (row.dataSource === 'Manual') {
        nav.removeInsertedTag(row.originalName)
        nav.insertTag(trimmed)
      } else {
        nav.setEditedTag(row.originalName, trimmed)
      }
      // Carry any constant value over to the new display name (dataset key).
      const existing = nav.tagConstants[row.tagName]
      if (existing !== undefined && trimmed !== row.tagName) {
        nav.setTagConstant(trimmed, existing)
        nav.setTagConstant(row.tagName, null)
      }
    },
    [nav],
  )

  // Only Manual / CSV-Upload tags (no real historian data) may carry a constant.
  const isConstantEditable = useCallback(
    (row: UnifiedTagRow) =>
      row.dataSource === 'Manual' || row.dataSource === 'CSV Upload',
    [],
  )

  const getConstant = useCallback(
    (row: UnifiedTagRow): number | undefined => nav.tagConstants[row.tagName],
    [nav.tagConstants],
  )

  const setConstant = useCallback(
    (row: UnifiedTagRow, value: number | null) => {
      nav.setTagConstant(row.tagName, value)
    },
    [nav],
  )

  const uploadCompare = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = e => {
        const text = (e.target?.result as string | null) ?? ''
        const firstLine = text.split('\n')[0] ?? ''
        const headers = firstLine
          .split(',')
          .map(c => c.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)

        const existingNames = new Set(
          rows.map(r => r.originalName.toLowerCase()),
        )
        for (const header of headers) {
          if (!existingNames.has(header.toLowerCase())) {
            nav.insertTag(header)
          }
        }
      }
      reader.readAsText(file)
    },
    [rows, nav],
  )

  return {
    rows,
    addRow,
    deleteRow,
    renameRow,
    uploadCompare,
    isConstantEditable,
    getConstant,
    setConstant,
  }
}
