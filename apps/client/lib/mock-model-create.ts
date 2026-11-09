// Phase-6 placeholder for the Create-Model page (same approved mock exception as
// `lib/mock-readings.ts` / `lib/mock-pi-servers.ts`). The artifact upload and the
// tag-list mapping are UI-only mock-ups: nothing here is persisted server-side yet.
// The tag catalog reuses `MOCK_PI_TAGS` from `lib/mock-readings.ts` (no duplicate
// mock data). When ingestion + a real model-config API land, swap the consumers of
// this file for `services/` calls — do not extend this pattern elsewhere.

/** Packaged ML artifact formats accepted by the (mock) upload section. */
export const ARTIFACT_EXTENSIONS = ['.pkg', '.mar', '.zip'] as const

/** Client-side size ceiling used for the mock upload's validation messaging. */
export const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024 // 200 MB

/** True when `fileName` ends with one of {@link ARTIFACT_EXTENSIONS}. */
export function hasArtifactExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return ARTIFACT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

export { formatBytes } from '@/lib/format-bytes'
