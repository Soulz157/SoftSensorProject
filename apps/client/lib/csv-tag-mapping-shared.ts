import { CheckCircle2, XCircle } from 'lucide-react'
import {
  MOCK_PI_TAGS,
  generateReadings,
  type SensorReading,
  type SensorQuality,
} from '@/lib/mock-readings'

export { MOCK_PI_TAGS }
export type { SensorReading, SensorQuality }
export type PiTagEntry = (typeof MOCK_PI_TAGS)[number]

export interface MappedTag {
  original: string
  input: string
  piTag: string | null
  status: 'match' | 'invalid'
  source: 'typed' | 'inserted'
}

export const CSV_COLUMNS = [
  'temp_c',
  'TI-101',
  'VI-202',
  'pressure_bar',
  'PI-303',
]

export const STATUS_META = {
  match: {
    label: 'Match',
    icon: CheckCircle2,
    classes: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    iconClass: 'text-emerald-500',
  },
  invalid: {
    label: 'Invalid',
    icon: XCircle,
    classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    iconClass: 'text-rose-500',
  },
}

export const SOURCE_TAG_STATUS: Record<string, SensorQuality> =
  Object.fromEntries(
    MOCK_PI_TAGS.map(t => [
      t.piTag,
      generateReadings(t.piTag, '24h').at(-1)?.status ?? 'Good',
    ]),
  )

export function parseManualTags(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function buildMappedTags(
  baseInputs: string[],
  insertedTags: string[],
  editedTags: Record<string, string>,
  removedTags: string[],
): MappedTag[] {
  const safeInserted = Array.isArray(insertedTags) ? insertedTags : []
  const safeRemoved = Array.isArray(removedTags) ? removedTags : []
  const safeEdited =
    editedTags && typeof editedTags === 'object' ? editedTags : {}

  const typedRows: MappedTag[] = baseInputs
    .filter(original => !safeRemoved.includes(original))
    .map(original => {
      const input = safeEdited[original] ?? original
      const match = MOCK_PI_TAGS.find(
        t => t.piTag.toLowerCase() === input.toLowerCase(),
      )
      return {
        original,
        input,
        piTag: match?.piTag ?? null,
        status: match ? 'match' : 'invalid',
        source: 'typed',
      } as MappedTag
    })

  const typedOriginals = new Set(typedRows.map(r => r.original))
  const insertedRows: MappedTag[] = safeInserted
    .filter(tag => !typedOriginals.has(tag) && !safeRemoved.includes(tag))
    .map(tag => ({
      original: tag,
      input: tag,
      piTag: tag,
      status: 'match' as const,
      source: 'inserted' as const,
    }))

  return [...typedRows, ...insertedRows]
}

export function qualityClass(q: SensorReading['status']): string {
  if (q === 'Good')
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  if (q === 'Questionable')
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
}

export function sourceStatusMeta(q: SensorQuality): {
  label: string
  dot: string
  classes: string
} {
  return q === 'Good'
    ? {
        label: 'Good',
        dot: 'bg-emerald-500',
        classes: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      }
    : {
        label: 'Error',
        dot: 'bg-rose-500',
        classes: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      }
}
