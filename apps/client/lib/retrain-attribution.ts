/**
 * MODEL-SERVE-026-T06. Which of a retrain's candidates is "B" — the current
 * version's OWN configuration refitted on the new data. With B on the same
 * shared window as the current version (A) and the picked candidate (C):
 *   A -> B is what the new DATA did (same settings, different data);
 *   B -> C is what the new SETTINGS did (same data, different settings).
 * Without B the two changes are confounded.
 */

/** Key-order-independent JSON, so `{a:1,b:2}` equals `{b:2,a:1}`. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** The runId of the SUCCEEDED candidate trained with the current version's
 *  own algorithm and hyperparameters, or null when none ran (Custom
 *  Finetune with the refit opted out, or B failed). */
export function currentSettingsRunId(
  candidates: readonly {
    runId: string | null
    algorithm: string
    hyperparameters: Record<string, unknown>
    status: string
  }[],
  current: {
    algorithm: string
    hyperparameters: Record<string, unknown> | null
  },
): string | null {
  const want = canonicalJson(current.hyperparameters ?? {})
  const hit = candidates.find(
    c =>
      c.status === 'SUCCEEDED' &&
      c.runId !== null &&
      c.algorithm === current.algorithm &&
      canonicalJson(c.hyperparameters) === want,
  )
  return hit?.runId ?? null
}

/** A -> B and B -> C as RMSE differences (negative = better). Null for any
 *  side not yet read. When C IS B, the settings effect is exactly 0. */
export function attributeChange(
  a: number | null,
  b: number | null,
  c: number | null,
): { dataEffect: number | null; settingsEffect: number | null } {
  return {
    dataEffect: a !== null && b !== null ? b - a : null,
    settingsEffect: b !== null && c !== null ? c - b : null,
  }
}
