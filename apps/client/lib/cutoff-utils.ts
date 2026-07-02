import type { SensorChartRow } from '@/hooks/use-sensor-readings'
import type { CutoffRule } from '@/types/cutoff'

function meetsRule(value: unknown, rule: CutoffRule): boolean {
  if (rule.value === '' || value == null) return false
  const v = Number(value)
  const threshold = Number(rule.value)
  switch (rule.op) {
    case '>':
      return v > threshold
    case '>=':
      return v >= threshold
    case '<':
      return v < threshold
    case '<=':
      return v <= threshold
    case '==':
      return v === threshold
    case '!=':
      return v !== threshold
  }
}

/** Set values to null for rows matching active clip rules. */
export function applyClipRules(
  rows: SensorChartRow[],
  rules: CutoffRule[],
): SensorChartRow[] {
  const clipRules = rules.filter(
    r => r.enabled && r.mode === 'clip' && r.value !== '',
  )
  if (clipRules.length === 0) return rows
  return rows.map(row => {
    const patched: SensorChartRow = { ...row }
    for (const rule of clipRules) {
      if (meetsRule(row[rule.tag], rule)) {
        patched[rule.tag] = null
      }
    }
    return patched
  })
}

/** Return set of `"${tag}__${rowIndex}"` keys matching active highlight rules. */
export function buildHighlightSet(
  rows: SensorChartRow[],
  rules: CutoffRule[],
): Set<string> {
  const hlRules = rules.filter(
    r => r.enabled && r.mode === 'highlight' && r.value !== '',
  )
  const set = new Set<string>()
  if (hlRules.length === 0) return set
  rows.forEach((row, index) => {
    for (const rule of hlRules) {
      if (meetsRule(row[rule.tag], rule)) {
        set.add(`${rule.tag}__${index}`)
      }
    }
  })
  return set
}
