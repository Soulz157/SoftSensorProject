'use client'

import { useCallback, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { getSourceTagCatalog, type MockTagRow } from '@/lib/mock-readings'
import { csvToDataset, parseCsvText } from '@/lib/csv'
import {
  dwSelectedSourcesAtom,
  dwCsvDatasetAtom,
  dwCsvFileNameAtom,
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

/**
 * @param tagsBySource Real PI tag names keyed by source id (from
 * `useDatasetTagMetadata`). When a source has them, rows are built from those
 * names so `originalName` matches the metadata map keys; sources without them
 * (demo ids, non-PI) keep the mock catalogue.
 */
export function useDatasetTagTable(
  nav: UseDatasetPipelineNavResult,
  tagsBySource: Map<string, string[]> = new Map(),
) {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const csvUploadTags = useAtomValue(dwCsvUploadTagsAtom)
  const removedTags = nav.removedTags
  const editedTags = nav.editedTags
  const insertedTags = nav.insertedTags

  const setCsvUploadTags = useSetAtom(dwCsvUploadTagsAtom)
  const setCsvDataset = useSetAtom(dwCsvDatasetAtom)
  const setCsvFileName = useSetAtom(dwCsvFileNameAtom)

  const rows = useMemo((): DatasetTagRow[] => {
    const result: DatasetTagRow[] = []
    const seen = new Set<string>()

    for (const source of sources) {
      // Real PI tags when the metadata call returned any — otherwise the mock
      // catalogue. Rows built from mock names could never match the metadata
      // map, which is why every enriched column rendered blank.
      const piTags = tagsBySource.get(source.id)
      const mockTags: MockTagRow[] =
        piTags && piTags.length > 0
          ? piTags.map(tagName => ({ tagName, status: 'good' as const }))
          : getSourceTagCatalog(source.id, source)

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
  }, [
    sources,
    tagsBySource,
    csvUploadTags,
    removedTags,
    editedTags,
    insertedTags,
  ])

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

  /**
   * Read an uploaded CSV in full — not just its header. The parsed grid lands in
   * `dwCsvDatasetAtom`, which Step 2 materializes into the raw dataset in place
   * of a fetch, so Step 1 is the single authoritative CSV entry point. The tag
   * rows still come from the columns (minus the detected timestamp column).
   *
   * Tags ACCUMULATE across uploads (unchanged "compare" semantics: a second file
   * adds its new columns rather than replacing the list). Tags carried over from
   * an earlier file that the new one lacks stay selectable but materialize as
   * Bad columns — deselect them in the table to drop them from the dataset.
   */
  const uploadCompare = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = e => {
        const text = (e.target?.result as string | null) ?? ''
        const dataset = csvToDataset(parseCsvText(text))
        setCsvDataset(dataset)
        setCsvFileName(file.name)
        // A new file invalidates whatever the previous one materialized. Same
        // reset chain every other raw-query mutation uses — without it the
        // fetch state stays `done` and Step 2 keeps showing the old grid.
        nav.resetFetch()

        const existingNames = new Set(
          rows.map(r => r.originalName.toLowerCase()),
        )
        const newHeaders = dataset.tags.filter(
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
    [rows, setCsvUploadTags, setCsvDataset, setCsvFileName, nav],
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
