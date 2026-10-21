/**
 * MODEL-SERVE-037-T05. The column-to-PI-tag table for a model trained on an
 * uploaded CSV, modelled on the feature preset Apply Mapping sheet
 * (`compareTags` in lib/feature-preset.ts): every training column is first
 * looked up in PI under its OWN name; a column PI does not know needs the
 * user to name its tag. Pure — the hook owns the PI lookups.
 */

export type MappingStatus = 'matched' | 'missing' | 'checking'

export interface MappingRow {
  /** The training column name. */
  column: string
  /** The target is optional: only the lab-truth join reads it live. */
  isTarget: boolean
  /** The PI tag this column is read from — its own name unless remapped. */
  tag: string
  /** True when `tag` differs from `column`. */
  remapped: boolean
  status: MappingStatus
}

export type MappingFilter = 'all' | 'matched' | 'attention'

export interface MappingSummary {
  matched: number
  /** Inputs that are not matched (the target never counts). */
  attention: number
  /** Every input resolves in PI — nothing blocks saving. */
  ready: boolean
}

/** The tag a column is read from: the user's entry, else its own name. */
export function effectiveTag(
  column: string,
  map: Record<string, string>,
): string {
  const entered = map[column]?.trim()
  return entered ? entered : column
}

/**
 * Inputs first, in training order, then the target. A tag is `matched`
 * only once PI confirmed it, `missing` once PI said it does not exist, and
 * `checking` until either — never assumed matched.
 */
export function buildMappingRows(input: {
  columns: string[]
  target: string | null
  map: Record<string, string>
  found: ReadonlySet<string>
  notFound: ReadonlySet<string>
}): MappingRow[] {
  const { columns, target, map, found, notFound } = input
  const ordered = [
    ...columns.map(column => ({ column, isTarget: false })),
    ...(target && !columns.includes(target)
      ? [{ column: target, isTarget: true }]
      : []),
  ]
  return ordered.map(({ column, isTarget }) => {
    const tag = effectiveTag(column, map)
    const status: MappingStatus = found.has(tag)
      ? 'matched'
      : notFound.has(tag)
        ? 'missing'
        : 'checking'
    return { column, isTarget, tag, remapped: tag !== column, status }
  })
}

export function summarizeMapping(rows: MappingRow[]): MappingSummary {
  const inputs = rows.filter(r => !r.isTarget)
  const matched = rows.filter(r => r.status === 'matched').length
  const attention = inputs.filter(r => r.status !== 'matched').length
  return { matched, attention, ready: inputs.length > 0 && attention === 0 }
}

/**
 * The map the server stores: every input (identity included, so the stored
 * binding names each column explicitly) and the target only when PI knows
 * its tag — an unresolved target would just leave the truth join empty.
 */
export function toColumnTagMap(rows: MappingRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    if (r.isTarget && r.status !== 'matched') continue
    out[r.column] = r.tag
  }
  return out
}

export function filterMappingRows(
  rows: MappingRow[],
  filter: MappingFilter,
  query: string,
): MappingRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter(r => {
    if (filter === 'matched' && r.status !== 'matched') return false
    if (filter === 'attention' && r.status === 'matched') return false
    if (!q) return true
    return r.column.toLowerCase().includes(q) || r.tag.toLowerCase().includes(q)
  })
}
