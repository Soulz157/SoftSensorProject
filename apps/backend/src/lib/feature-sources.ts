/**
 * MODEL-SERVE-001-T15. Which SOURCE COLUMNS does a derived feature read?
 *
 * `feature_spec.json` records every feature's `{name, kind, config}` in
 * APPLICATION order (`feature_spec_service.build_feature_spec`). A derived
 * feature's data quality is decided entirely by its sources: apps/python's
 * `_compute_feature_column` pulls every source through `_good_value` and
 * writes `(0.0, STATUS_BAD)` the moment ANY required source is not Good —
 * formula/ratio/arith/log/lag/delta/rolling all gate identically. This
 * module answers "which columns feed this one", so that upstream rule can
 * be DISPLAYED against live per-tag status rather than re-invented.
 *
 * TRANSITIVE BY NECESSITY: `apply_features` mutates one frame across
 * configs in order, so a feature's source can itself be an earlier DERIVED
 * column (a rolling mean of a lag, a formula over a ratio). Resolving only
 * direct sources would stop at that intermediate column and never reach the
 * base tag whose status actually decides the outcome — the same reason
 * `feature_spec_service._derived_from_target` computes a transitive closure
 * rather than a direct-read check.
 *
 * Pure functions, no I/O — same discipline as `prediction-drift.ts`.
 */

/** One `feature_spec.json` `features[]` entry, kept deliberately loose:
 *  the authority on config shape is `build_feature_spec` (python), not this
 *  type, and a spec only ever WIDENS over time. */
export interface FeatureSpecEntry {
  name?: string;
  kind?: string;
  config?: Record<string, unknown>;
}

export interface FeatureSourceResolution {
  /** Derived column name -> the BASE tags it transitively depends on.
   *  A base tag is any column that is not itself a derived feature name. */
  baseSourcesByColumn: Record<string, string[]>;
  /** Derived columns whose `kind` this module does not recognise, or whose
   *  source chain reaches one. Reported as its own set rather than folded
   *  into an empty source list, because "no sources" (a `datetime` part,
   *  which reads the timestamp and no tag at all) and "sources unknown"
   *  are different answers and must not display the same. */
  unresolved: Set<string>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * The columns ONE config reads directly, per kind — config shapes are the
 * ones `lib/feature-engineering.ts`'s `FeatureConfig` union declares and
 * `_compute_feature_column` consumes.
 *
 * Returns `null` for an unrecognised kind — distinct from `[]`, which means
 * "recognised, and genuinely reads no tag" (`datetime`, which derives from
 * the row's timestamp).
 */
export function directSources(entry: FeatureSpecEntry): string[] | null {
  const config = entry.config ?? {};
  switch (entry.kind) {
    case 'formula': {
      // `vars` maps an expression alias ("c0") to the column it reads.
      const vars = config.vars;
      if (typeof vars !== 'object' || vars === null) return null;
      return Object.values(vars as Record<string, unknown>).filter(
        (v): v is string => typeof v === 'string',
      );
    }
    case 'lag':
    case 'rolling':
    case 'delta':
    case 'log':
      return typeof config.tag === 'string' ? [config.tag] : null;
    case 'arith':
    case 'ratio':
      return asStringArray(config.tags);
    case 'datetime':
      // Reads the timestamp, never a tag — always computable, so no tag's
      // status can make it Bad.
      return [];
    default:
      return null;
  }
}

/**
 * Resolve every derived feature to the BASE tags it ultimately depends on.
 *
 * Cycles cannot occur in a well-formed spec (features apply in order, so a
 * config can only read columns that already exist), but the walk guards
 * against one anyway rather than recursing forever on a malformed spec.
 */
export function resolveFeatureSources(
  features: FeatureSpecEntry[],
): FeatureSourceResolution {
  const byName = new Map<string, FeatureSpecEntry>();
  for (const f of features) {
    if (typeof f.name === 'string') byName.set(f.name, f);
  }

  const baseSourcesByColumn: Record<string, string[]> = {};
  const unresolved = new Set<string>();
  const resolving = new Set<string>();

  function walk(column: string): string[] | null {
    const entry = byName.get(column);
    // Not a derived feature at all — it IS a base tag, and is its own source.
    if (!entry) return [column];

    const cached = baseSourcesByColumn[column];
    if (cached) return cached;
    if (unresolved.has(column)) return null;
    // Malformed spec (a cycle): refuse rather than recurse forever.
    if (resolving.has(column)) return null;

    const direct = directSources(entry);
    if (direct === null) {
      unresolved.add(column);
      return null;
    }

    resolving.add(column);
    const bases = new Set<string>();
    for (const source of direct) {
      const resolved = walk(source);
      if (resolved === null) {
        resolving.delete(column);
        unresolved.add(column);
        return null;
      }
      for (const base of resolved) bases.add(base);
    }
    resolving.delete(column);

    const result = [...bases].sort();
    baseSourcesByColumn[column] = result;
    return result;
  }

  for (const name of byName.keys()) walk(name);

  return { baseSourcesByColumn, unresolved };
}
