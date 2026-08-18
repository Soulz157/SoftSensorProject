import { fetchClient } from '@/lib/fetcher'
import type {
  PresetDocument,
  PresetSummary,
  SdtaConfig,
} from '@/lib/feature-preset'

interface ApiResponse<T> {
  data: T
  statusCode: number
  message: string
  type: string
}

/** Summary of the workbook upload a set of presets came from. */
export interface PresetImportSummary {
  id: string
  fileName: string
  sheetCount: number
  /** Sheets with no `No | Y | X` header. An SD&TA sheet is parsed, not skipped. */
  skippedSheets: string[]
  sdtaKey: string | null
  createdAt: string
}

export interface PresetListResult {
  /** Null when the workspace has never imported a workbook. */
  import: PresetImportSummary | null
  presets: PresetSummary[]
}

export interface PresetImportResult {
  importId: string
  fileName: string
  objectPrefix: string
  sheetCount: number
  unitCount: number
  presetCount: number
  skippedSheets: string[]
  sdta: {
    object_key: string
    range_count: number
    condition_count: number
  } | null
  importedAt: string
}

export const featurePresetService = {
  /**
   * Presets from the workspace's latest import, or from `importId` when one is
   * named. Latest-only by default: the same unit and config reappear in every
   * re-upload, and only the newest copy points at the objects a user means to
   * apply, so returning all of them would fill the picker with duplicates.
   */
  list: (
    workspaceId: string,
    importId?: string,
  ): Promise<ApiResponse<PresetListResult>> =>
    fetchClient(
      `/api/v1/authorized/feature-preset?workspaceId=${encodeURIComponent(workspaceId)}` +
        (importId ? `&importId=${encodeURIComponent(importId)}` : ''),
      { method: 'GET' },
    ),

  /** The full stored preset: target, features, equations, required tags. */
  getDocument: (id: string): Promise<ApiResponse<PresetDocument>> =>
    fetchClient(`/api/v1/authorized/feature-preset/${id}/document`, {
      method: 'GET',
    }),

  deleteImport: (id: string): Promise<ApiResponse<null>> =>
    fetchClient(`/api/v1/authorized/feature-preset/imports/${id}`, {
      method: 'DELETE',
    }),

  /**
   * The SD&TA cut config for one import. 404s when the workbook had no
   * SD&TA sheet — callers gate on `PresetImportSummary.sdtaKey` first so this
   * is only called when one is expected to exist.
   */
  getSdtaDocument: (importId: string): Promise<ApiResponse<SdtaConfig>> =>
    fetchClient(`/api/v1/authorized/feature-preset/imports/${importId}/sdta`, {
      method: 'GET',
    }),

  /**
   * Upload a workbook.
   *
   * Deliberately bypasses `fetchClient`: it sets `Content-Type: application/json`
   * on any non-null body (lib/fetcher.ts), which would stamp JSON onto a
   * multipart request and destroy the boundary — the server would then see a
   * body with no parts. Leaving the header unset lets the browser derive it and
   * append the boundary itself. Mirrors `workspaceService.uploadWorkspaceThumbnail`,
   * the only other upload in this client, for the same reason.
   */
  importWorkbook: async (
    workspaceId: string,
    file: File,
  ): Promise<ApiResponse<PresetImportResult>> => {
    const { getSession } = await import('next-auth/react')
    const session = await getSession()

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/authorized/feature-preset/imports?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        method: 'POST',
        body: formData,
        headers: session?.user?.accessToken
          ? { Authorization: `Bearer ${session.user.accessToken}` }
          : {},
      },
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { message?: string }).message ?? `Upload failed: ${res.status}`,
      )
    }
    return res.json() as Promise<ApiResponse<PresetImportResult>>
  },
}
