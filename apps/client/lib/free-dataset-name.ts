/**
 * DS-LAKE-036. The first of `base`, `base (2)`, `base (3)`, … not already
 * taken. Dataset names are unique per workspace (`Dataset_workspaceId_name_key`),
 * so a retrain handoff that always proposed `{base} — new data` collided on the
 * second retrain of the same base, and Save refused it.
 *
 * Compared after trimming, case-sensitively — the database constraint is a
 * plain unique index, so "a" and "A" are different names there too.
 */
export function freeDatasetName(base: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const name of taken) used.add(name.trim())
  const wanted = base.trim()
  if (!used.has(wanted)) return wanted
  for (let n = 2; ; n++) {
    const candidate = `${wanted} (${n})`
    if (!used.has(candidate)) return candidate
  }
}
