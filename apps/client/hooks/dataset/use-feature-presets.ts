'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  featurePresetService,
  type PresetImportSummary,
} from '@/services/feature-preset'
import type {
  PresetDocument,
  PresetSummary,
  SdtaConfig,
} from '@/lib/feature-preset'

export interface UseFeaturePresetsResult {
  /** Presets from the workspace's latest import. */
  presets: PresetSummary[]
  /** The upload they came from. Null until a workbook has been imported. */
  currentImport: PresetImportSummary | null
  loading: boolean
  /** True while a workbook is being parsed server-side. */
  importing: boolean
  /** Last failure, for the sheet's error state. Cleared on the next attempt. */
  error: string | null
  refetch: () => Promise<void>
  /** Upload a workbook, then refresh the list. Resolves to the new presets. */
  importWorkbook: (file: File) => Promise<PresetSummary[]>
  /** Fetch one preset's full document (equations, required tags). */
  loadDocument: (id: string) => Promise<PresetDocument>
  /** Fetch the SD&TA cut config for an import that has one. */
  loadSdta: (importId: string) => Promise<SdtaConfig>
}

/**
 * Feature presets for one workspace.
 *
 * Plain `useState` + `useCallback`, matching `use-datasets.ts` — this codebase
 * has no React Query in the dataset path, and introducing it for one hook would
 * make two caching stories to reason about.
 *
 * Documents are NOT fetched here. The list is metadata only; the equations live
 * in object storage and are pulled on demand by `loadDocument`, so opening the
 * picker does not drag every preset's formulas across the wire.
 */
export function useFeaturePresets(
  workspaceId: string,
): UseFeaturePresetsResult {
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [currentImport, setCurrentImport] =
    useState<PresetImportSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    // No workspace yet (the wizard seeds it a tick later) — not an error state,
    // just nothing to ask for.
    if (!workspaceId) {
      setPresets([])
      setCurrentImport(null)
      return
    }

    setLoading(true)
    try {
      const res = await featurePresetService.list(workspaceId)
      setPresets(res.data?.presets ?? [])
      setCurrentImport(res.data?.import ?? null)
      setError(null)
    } catch (e) {
      // Surfaced rather than swallowed: an empty picker with no explanation
      // reads as "this workspace has no presets", which may be false.
      setError(
        e instanceof Error ? e.message : 'Could not load feature presets',
      )
      setPresets([])
      setCurrentImport(null)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const importWorkbook = useCallback(
    async (file: File): Promise<PresetSummary[]> => {
      setImporting(true)
      setError(null)
      try {
        await featurePresetService.importWorkbook(workspaceId, file)
        // Read back rather than trusting the upload response: the list is the
        // shape the picker renders, and it carries the row ids that
        // `loadDocument` needs.
        const res = await featurePresetService.list(workspaceId)
        const next = res.data?.presets ?? []
        setPresets(next)
        setCurrentImport(res.data?.import ?? null)
        return next
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Import failed'
        setError(message)
        throw e
      } finally {
        setImporting(false)
      }
    },
    [workspaceId],
  )

  const loadDocument = useCallback(async (id: string) => {
    const res = await featurePresetService.getDocument(id)
    return res.data
  }, [])

  const loadSdta = useCallback(async (importId: string) => {
    const res = await featurePresetService.getSdtaDocument(importId)
    return res.data
  }, [])

  return {
    presets,
    currentImport,
    loading,
    importing,
    error,
    refetch,
    importWorkbook,
    loadDocument,
    loadSdta,
  }
}
