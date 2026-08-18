const DELIMITERS = /[,;\n\r\t]+/

export type TagSearch =
  | { mode: 'wildcard'; pattern: string }
  | { mode: 'patterns'; patterns: string[] }
  | { mode: 'names'; names: string[] }

function toWildcard(q: string): string {
  if (!q) return '*'
  return q.includes('*') || q.includes('?') ? q : `*${q}*`
}

export function parseTagSearch(input: string): TagSearch {
  const trimmed = input.trim()
  if (!trimmed) return { mode: 'wildcard', pattern: '*' }

  if (DELIMITERS.test(trimmed)) {
    const parts = [
      ...new Set(
        trimmed
          .split(DELIMITERS)
          .map(s => s.trim())
          .filter(Boolean),
      ),
    ]
    if (parts.length <= 1) {
      return { mode: 'wildcard', pattern: toWildcard(parts[0] ?? '') }
    }
    if (parts.some(p => p.includes('*') || p.includes('?'))) {
      return { mode: 'patterns', patterns: parts.map(toWildcard) }
    }
    return { mode: 'names', names: parts }
  }

  return { mode: 'wildcard', pattern: toWildcard(trimmed) }
}
