import { parse, type MathNode } from 'mathjs'

export interface FormulaValidation {
  ok: boolean
  error?: string
  used: string[]
}

export function validateFormula(
  expr: string,
  vars: Record<string, string>,
  sourceColumns: string[],
): FormulaValidation {
  const trimmed = expr.trim()
  if (!trimmed) return { ok: false, error: 'Enter a formula', used: [] }

  let node: MathNode
  try {
    node = parse(trimmed)
  } catch (e) {
    return { ok: false, error: `Syntax: ${(e as Error).message}`, used: [] }
  }

  const used = new Set<string>()
  let blocked: string | null = null
  node.traverse(n => {
    // กัน code-exec: ห้ามประกาศฟังก์ชัน / assign ตัวแปร
    if (n.type === 'AssignmentNode' || n.type === 'FunctionAssignmentNode')
      blocked = 'Assignments are not allowed'
    if (n.type === 'SymbolNode')
      used.add((n as unknown as { name: string }).name)
  })
  if (blocked) return { ok: false, error: blocked, used: [] }

  const aliases = Object.keys(vars)
  const unknown = [...used].filter(u => !aliases.includes(u))
  if (unknown.length)
    return {
      ok: false,
      error: `Unknown variable(s): ${unknown.join(', ')} — add & map below`,
      used: [...used],
    }

  const unmapped = aliases.filter(
    a => !vars[a] || !sourceColumns.includes(vars[a]!),
  )
  if (unmapped.length)
    return {
      ok: false,
      error: `Assign a column to: ${unmapped.join(', ')}`,
      used: [...used],
    }

  return { ok: true, used: [...used] }
}

export function compileFormula(expr: string) {
  return parse(expr).compile()
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

/** Characters that can appear inside a column name (so boundaries exclude them). */
const COL_BOUNDARY = '[\\w.\\-]'

/**
 * Build a boundary-aware alternation matching any source column, longest first
 * (so `TI-1011` wins over `TI-101`). Returns null when there are no columns.
 */
function columnMatcher(sourceColumns: string[]): RegExp | null {
  const cols = [...sourceColumns]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (cols.length === 0) return null
  const alt = cols.map(escapeRegExp).join('|')
  return new RegExp(`(?<!${COL_BOUNDARY})(?:${alt})(?!${COL_BOUNDARY})`, 'g')
}

export interface TokenizedFormula {
  /** Expression with every recognized column replaced by an alias (`c0`, `c1`…). */
  aliasExpr: string
  /** alias → column name (the shape `validateFormula`/`applyFeatures` expect). */
  vars: Record<string, string>
  /** Identifier-like tokens the user typed that match no column. */
  unknownTokens: string[]
}

/**
 * Turn a human-typed expression using real column names (which may contain
 * `-`/`.`, invalid as mathjs symbols) into the engine's alias form. Pure.
 * Same column reused across the expression maps to the same alias.
 */
export function tokenizeColumns(
  rawExpr: string,
  sourceColumns: string[],
): TokenizedFormula {
  const matcher = columnMatcher(sourceColumns)
  const aliasByCol = new Map<string, string>()
  const vars: Record<string, string> = {}

  const aliasExpr = matcher
    ? rawExpr.replace(matcher, col => {
        let alias = aliasByCol.get(col)
        if (!alias) {
          alias = `c${aliasByCol.size}`
          aliasByCol.set(col, alias)
          vars[alias] = col
        }
        return alias
      })
    : rawExpr

  // Any remaining identifier that isn't a generated alias is an unknown token.
  const aliases = new Set(Object.keys(vars))
  const unknownTokens = [
    ...new Set(
      (aliasExpr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter(
        t => !aliases.has(t),
      ),
    ),
  ]

  return { aliasExpr, vars, unknownTokens }
}

export type FormulaSegment = {
  text: string
  kind: 'column' | 'op' | 'unknown'
}

/**
 * Split a raw expression into ordered segments for coloured highlighting:
 * recognized columns, operators/numbers/parens (`op`), and bare identifiers
 * that match no column (`unknown`). Pure — no React.
 */
export function formulaSegments(
  rawExpr: string,
  sourceColumns: string[],
): FormulaSegment[] {
  const matcher = columnMatcher(sourceColumns)
  const segments: FormulaSegment[] = []

  const pushNonColumn = (text: string) => {
    if (!text) return
    // Split identifier runs out so bare words render as `unknown`.
    const parts = text.split(/([A-Za-z_][A-Za-z0-9_]*)/)
    for (const part of parts) {
      if (!part) continue
      segments.push({
        text: part,
        kind: /^[A-Za-z_]/.test(part) ? 'unknown' : 'op',
      })
    }
  }

  if (!matcher) {
    pushNonColumn(rawExpr)
    return segments
  }

  let last = 0
  for (const m of rawExpr.matchAll(matcher)) {
    const start = m.index
    pushNonColumn(rawExpr.slice(last, start))
    segments.push({ text: m[0], kind: 'column' })
    last = start + m[0].length
  }
  pushNonColumn(rawExpr.slice(last))
  return segments
}

type Row = { cells: Record<string, { value: number } | undefined> }

export function evalFormulaRow(
  compiled: ReturnType<typeof compileFormula>,
  vars: Record<string, string>,
  row: Row,
): number | null {
  const scope: Record<string, number> = {}
  for (const a in vars) {
    const cell = row.cells[vars[a]!]
    if (!cell || !Number.isFinite(cell.value)) return null
    scope[a] = cell.value
  }
  const out = compiled.evaluate(scope)
  return typeof out === 'number' && Number.isFinite(out) ? out : null
}
