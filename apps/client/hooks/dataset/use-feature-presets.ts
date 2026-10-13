'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  featurePresetService,
  type PresetImportSummary,
  type PresetUpload,
} from '@/services/feature-preset'
import type {
  PresetDocument,
  PresetSummary,
  SdtaConfig,
} from '@/lib/feature-preset'

export interface UseFeaturePresetsResult {
  /**
   * Presets from the selected upload. Opens on the user's OWN latest upload,
   * or the workspace's latest when they have never uploaded.
   */
  presets: PresetSummary[]
  /** The upload they came from. Null until a workbook has been imported. */
  currentImport: PresetImportSummary | null
  /** The user's own uploads, newest first. */
  uploads: PresetUpload[]
  loading: boolean
  /** True while a workbook is being parsed server-side. */
  importing: boolean
  /** Last failure, for the sheet's error state. Cleared on the next attempt. */
  error: string | null
  refetch: () => Promise<void>
  /** Upload a workbook, then refresh the list. Resolves to the new presets. */
  importWorkbook: (file: File) => Promise<PresetSummary[]>
  /**
   * Switch the picker to another upload's presets - e.g. the template the
   * user uploaded themselves when a teammate has uploaded since. Resolves to
   * that upload's presets; rejects (and sets `error`) when it cannot load.
   */
  selectImport: (importId: string) => Promise<PresetSummary[]>
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
 *
 * Which upload it opens on (user decision 2026-10-12): the user's OWN latest,
 * so the Manager starts on the template they uploaded rather than whoever
 * uploaded last. A user with no uploads falls back to the workspace latest, so
 * a shared template is still usable. A failure to read the user's uploads
 * never blocks the picker - it falls back the same way.
 */
export function useFeaturePresets(
  workspaceId: string,
): UseFeaturePresetsResult {
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [currentImport, setCurrentImport] =
    useState<PresetImportSummary | null>(null)
  const [uploads, setUploads] = useState<PresetUpload[]>([])
  const [loading, setLoading] = useState(() => !!workspaceId)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No workspace yet (the wizard seeds it a tick later) — not an error state,
  // just nothing to ask for. Cleared during render when the workspace
  // changes, rather than synchronously inside the effect's fetch.
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId)
  if (prevWorkspaceId !== workspaceId) {
    setPrevWorkspaceId(workspaceId)
    setLoading(!!workspaceId)
    if (!workspaceId) {
      setPresets([])
      setCurrentImport(null)
      setUploads([])
    }
  }

  /** Resolves to the user's uploads, or none when they cannot be read. */
  const readUploads = useCallback(async (): Promise<PresetUpload[]> => {
    if (!workspaceId) return []
    return featurePresetService.listImports(workspaceId).then(
      res => res.data ?? [],
      // Deliberately quiet: see the hook's doc comment.
      () => [],
    )
  }, [workspaceId])

  // Every setState here runs inside a promise callback, after a request has
  // settled - never synchronously in the effect that calls this (and not after
  // a bare `await` either, which the React compiler lint cannot tell apart).
  const fetchPresets = useCallback((): Promise<void> => {
    if (!workspaceId) return Promise.resolve()
    return readUploads()
      .then(mine => {
        setUploads(mine)
        const ownLatest = mine.find(u => u.isLatest) ?? mine[0]
        return featurePresetService.list(workspaceId, ownLatest?.id).then(
          res => {
            setPresets(res.data?.presets ?? [])
            setCurrentImport(res.data?.import ?? null)
            setError(null)
          },
          (e: unknown) => {
            // Surfaced rather than swallowed: an empty picker with no
            // explanation reads as "this workspace has no presets", which may
            // be false.
            setError(
              e instanceof Error ? e.message : 'Could not load feature presets',
            )
            setPresets([])
            setCurrentImport(null)
          },
        )
      })
      .finally(() => setLoading(false))
  }, [workspaceId, readUploads])

  const refetch = useCallback(async () => {
    if (workspaceId) setLoading(true)
    await fetchPresets()
  }, [workspaceId, fetchPresets])

  useEffect(() => {
    void fetchPresets()
  }, [fetchPresets])

  const importWorkbook = useCallback(
    async (file: File): Promise<PresetSummary[]> => {
      setImporting(true)
      setError(null)
      try {
        await featurePresetService.importWorkbook(workspaceId, file)
        // Read back rather than trusting the upload response: the list is the
        // shape the picker renders, and it carries the row ids that
        // `loadDocument` needs. The new upload is now the workspace latest,
        // so the default list IS it.
        const res = await featurePresetService.list(workspaceId)
        const next = res.data?.presets ?? []
        setPresets(next)
        setCurrentImport(res.data?.import ?? null)
        // The upload just made is now the user's latest.
        setUploads(await readUploads())
        return next
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Import failed'
        setError(message)
        throw e
      } finally {
        setImporting(false)
      }
    },
    [workspaceId, readUploads],
  )

  const selectImport = useCallback(
    async (importId: string): Promise<PresetSummary[]> => {
      setLoading(true)
      setError(null)
      try {
        const res = await featurePresetService.list(workspaceId, importId)
        const next = res.data?.presets ?? []
        setPresets(next)
        setCurrentImport(res.data?.import ?? null)
        return next
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load that upload')
        throw e
      } finally {
        setLoading(false)
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
    uploads,
    loading,
    importing,
    error,
    refetch,
    importWorkbook,
    selectImport,
    loadDocument,
    loadSdta,
  }
}
