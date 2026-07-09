'use client'

import { useCallback, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { getSourceTagCatalog } from '@/lib/mock-readings'
import {
  dwSelectedSourcesAtom,
  dwCsvUploadTagsAtom,
} from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from './use-dataset-pipeline-nav'

export interface DatasetTagRow {
  id: string
  tagName: string
  originalName: string
  dataSource: string
  status: 'good' | 'error'
  errorReason?: string
}

export function useDatasetTagTable(nav: UseDatasetPipelineNavResult) {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const csvUploadTags = useAtomValue(dwCsvUploadTagsAtom)
  const removedTags = nav.removedTags
  const editedTags = nav.editedTags
  const insertedTags = nav.insertedTags

  const setCsvUploadTags = useSetAtom(dwCsvUploadTagsAtom)

  const rows = useMemo((): DatasetTagRow[] => {
    const result: DatasetTagRow[] = []
    const seen = new Set<string>()

    for (const source of sources) {
      const mockTags = getSourceTagCatalog(source.id, source)

      for (const mock of mockTags) {
        if (removedTags.includes(mock.tagName) || seen.has(mock.tagName))
          continue
        seen.add(mock.tagName)
        const tagName = editedTags[mock.tagName] ?? mock.tagName
        result.push({
          id: `${source.id}::${mock.tagName}`,
          tagName,
          originalName: mock.tagName,
          dataSource: source.name,
          status: mock.status,
          errorReason: mock.errorReason,
        })
      }
    }

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
  }, [sources, csvUploadTags, removedTags, editedTags, insertedTags])

  const addRow = useCallback((): string => {
    const placeholder = `new-tag-${Date.now()}`
    nav.insertTag(placeholder)
    return `manual::${placeholder}`
  }, [nav])

  const deleteRow = useCallback(
    (row: DatasetTagRow) => {
      nav.setTagConstant(row.tagName, null)
      if (row.dataSource === 'Manual') {
        nav.removeInsertedTag(row.originalName)
      } else if (row.dataSource === 'CSV Upload') {
        setCsvUploadTags(prev => prev.filter(t => t !== row.originalName))
      } else {
        nav.removeTag(row.originalName)
      }
    },
    [nav],
  )

  const renameRow = useCallback(
    (row: DatasetTagRow, newName: string) => {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === row.originalName) return
      if (row.dataSource === 'Manual') {
        nav.removeInsertedTag(row.originalName)
        nav.insertTag(trimmed)
      } else {
        nav.setEditedTag(row.originalName, trimmed)
      }
      const existing = nav.tagConstants[row.tagName]
      if (existing !== undefined && trimmed !== row.tagName) {
        nav.setTagConstant(trimmed, existing)
        nav.setTagConstant(row.tagName, null)
      }
    },
    [nav],
  )

  const isConstantEditable = useCallback(
    (row: DatasetTagRow) =>
      row.dataSource === 'Manual' || row.dataSource === 'CSV Upload',
    [],
  )

  const getConstant = useCallback(
    (row: DatasetTagRow): number | undefined => nav.tagConstants[row.tagName],
    [nav.tagConstants],
  )

  const setConstant = useCallback(
    (row: DatasetTagRow, value: number | null) => {
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
        const newHeaders = headers.filter(
          h => !existingNames.has(h.toLowerCase()),
        )
        if (newHeaders.length > 0) {
          setCsvUploadTags(prev => [
            ...prev,
            ...newHeaders.filter(h => !prev.includes(h)),
          ])
        }
      }
      reader.readAsText(file)
    },
    [rows, setCsvUploadTags],
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
