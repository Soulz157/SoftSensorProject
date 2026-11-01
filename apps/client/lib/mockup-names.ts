/**
 * Display-name substitution for document mockups: the real page renders
 * unchanged, but every API payload has its plant identity swapped for
 * agreed mock names before React sees it. Pure — the dev-only mockup route
 * owns the fetch patch that calls these.
 */

export interface MockupNameMap {
  /** Entity id → mock name. Applied to `name` on any object carrying that
   *  `id`, and to `<x>Name` beside a matching `<x>Id`. By id, never by
   *  string, because two different entities can share a real name (a
   *  workspace and a plant both called "MOC"). */
  byId: Record<string, string>
  /** Real token → mock token (tags, model name). Matched at alphanumeric
   *  boundaries in object keys and string values alike, longest first. */
  tokens: Record<string, string>
  /** Entity id → fields to overwrite (only fields already present as
   *  strings): a user's firstName/lastName/email, a data source's host. */
  fieldsById?: Record<string, Record<string, string>>
  /** Whole-string replacements for free-text values such as a person's
   *  full name in `deployedBy` — too short to match safely inside text. */
  exactValues?: Record<string, string>
  /** Real fragments that must never survive a rewrite; reported by
   *  `findLeaks`. */
  leakTokens: string[]
}

/** Credentials pass through untouched. */
const SECRET_KEY = /token|secret|password/i

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One left-to-right pass, so "Dataset-s611water" is taken whole before the
 *  bare "s611water" inside it can match. */
export function tokenReplacer(
  tokens: Record<string, string>,
): (s: string) => string {
  const keys = Object.keys(tokens).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return s => s
  const re = new RegExp(
    `(?<![A-Za-z0-9])(${keys.map(escape).join('|')})(?![A-Za-z0-9])`,
    'g',
  )
  return s => s.replace(re, m => tokens[m] ?? m)
}

export function invertTokens(
  tokens: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens).map(([k, v]) => [v, k]))
}

function remapWith(
  value: unknown,
  map: MockupNameMap,
  replace: (s: string) => string,
): unknown {
  const { byId } = map
  if (typeof value === 'string') {
    return map.exactValues?.[value] ?? replace(value)
  }
  if (Array.isArray(value)) return value.map(v => remapWith(v, map, replace))
  if (value === null || typeof value !== 'object') return value

  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) {
    out[replace(k)] = SECRET_KEY.test(k) ? v : remapWith(v, map, replace)
  }
  if (typeof src.id === 'string') {
    const mock = byId[src.id]
    if (mock !== undefined && typeof src.name === 'string') out.name = mock
    for (const [k, v] of Object.entries(map.fieldsById?.[src.id] ?? {})) {
      if (typeof src[k] === 'string') out[k] = v
    }
  }
  for (const [k, v] of Object.entries(src)) {
    if (!k.endsWith('Id') || typeof v !== 'string') continue
    const mock = byId[v]
    const nameKey = `${k.slice(0, -2)}Name`
    if (mock !== undefined && typeof src[nameKey] === 'string') {
      out[nameKey] = mock
    }
  }
  return out
}

/** Deep copy of `value` with mock names in keys and values. */
export function remapNames<T>(value: T, map: MockupNameMap): T {
  return remapWith(value, map, tokenReplacer(map.tokens)) as T
}

/** Real fragments still present in `text`, at a left boundary so enum words
 *  like "PROCESSING" do not count as "ROC". */
export function findLeaks(text: string, leakTokens: string[]): string[] {
  return leakTokens.filter(t =>
    new RegExp(`(?<![A-Za-z0-9])${escape(t)}`).test(text),
  )
}
