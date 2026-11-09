/**
 * MODEL-SERVE-037-T02. A "live source override": a model trained on a
 * dataset no source of which the scheduler can read (a CSV upload) is bound
 * to a PI source the dataset never named, with an explicit map from each
 * training column to the PI tag that carries it live.
 *
 * Stored inside `InferenceSchedule.fetchConfig` (a Json column — no schema
 * change). `baseTags` holds the MAPPED PI tags, because the scheduler's
 * `asFetchConfig` turns `baseTags` into the PI `tag_list`; `columnTagMap`
 * travels beside it so materialize can rename the fetched columns back to
 * the training names (T03). Pure — no Prisma, no I/O.
 */

/** Marker key: present and `true` only on an override binding. */
export const LIVE_SOURCE_OVERRIDE_KEY = 'liveSourceOverride';

/** PI summary settings the override fetches with — the dataset's own
 *  fetch config cannot supply them, since the dataset never read PI. */
export interface LiveOverrideFetch {
  intervalTime: string;
  calcType: string;
  calcBasis: string;
}

export interface LiveSourceOverride extends LiveOverrideFetch {
  columnTagMap: Record<string, string>;
}

export type ColumnTagMapCheck =
  | { ok: true; columnTagMap: Record<string, string>; tags: string[] }
  | { ok: false; reason: string };

/**
 * Every `required` column must map to a non-blank tag; `optional` columns
 * (the target, for the truth join) may be mapped or left out. Anything else
 * is refused, and so is one tag claimed by two columns — the rename after
 * the fetch maps a tag back to ONE column name and cannot fan it out.
 */
export function checkColumnTagMap(
  required: readonly string[],
  optional: readonly string[],
  map: Record<string, string>,
): ColumnTagMapCheck {
  const allowed = new Set([...required, ...optional]);
  const cleaned: Record<string, string> = {};
  for (const [column, tag] of Object.entries(map)) {
    const t = tag.trim();
    if (t) cleaned[column] = t;
  }

  const unknown = Object.keys(cleaned).filter((c) => !allowed.has(c));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `Not an input of this model: ${unknown.join(', ')}.`,
    };
  }

  const unmapped = required.filter((c) => !cleaned[c]);
  if (unmapped.length > 0) {
    return {
      ok: false,
      reason:
        `Map every model input to a PI tag. Unmapped: ` +
        `${unmapped.join(', ')}.`,
    };
  }

  const byTag = new Map<string, string[]>();
  for (const [column, tag] of Object.entries(cleaned)) {
    byTag.set(tag, [...(byTag.get(tag) ?? []), column]);
  }
  const shared = [...byTag.entries()].filter(([, cols]) => cols.length > 1);
  if (shared.length > 0) {
    return {
      ok: false,
      reason:
        'Each PI tag can feed only one column. ' +
        shared
          .map(([tag, cols]) => `${tag} is mapped to ${cols.join(', ')}`)
          .join('; ') +
        '.',
    };
  }

  return { ok: true, columnTagMap: cleaned, tags: [...byTag.keys()] };
}

/** The `InferenceSchedule.fetchConfig` an override binding writes. */
export function buildOverrideFetchConfig(
  fetch: LiveOverrideFetch,
  columnTagMap: Record<string, string>,
): {
  type: 'pi';
  intervalTime: string;
  calcType: string;
  calcBasis: string;
  baseTags: string[];
  columnTagMap: Record<string, string>;
  [LIVE_SOURCE_OVERRIDE_KEY]: true;
} {
  return {
    type: 'pi',
    intervalTime: fetch.intervalTime,
    calcType: fetch.calcType,
    calcBasis: fetch.calcBasis,
    baseTags: Object.values(columnTagMap),
    columnTagMap,
    [LIVE_SOURCE_OVERRIDE_KEY]: true,
  };
}

/** The override a stored `fetchConfig` carries, or null for an ordinary
 *  dataset-derived binding. Defensive: the column is untyped Json. */
export function readLiveSourceOverride(
  fetchConfig: unknown,
): LiveSourceOverride | null {
  if (!fetchConfig || typeof fetchConfig !== 'object') return null;
  const raw = fetchConfig as Record<string, unknown>;
  if (raw[LIVE_SOURCE_OVERRIDE_KEY] !== true) return null;
  const map = raw.columnTagMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const columnTagMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (typeof v === 'string') columnTagMap[k] = v;
  }
  return {
    intervalTime:
      typeof raw.intervalTime === 'string' ? raw.intervalTime : '1m',
    calcType: typeof raw.calcType === 'string' ? raw.calcType : 'Average',
    calcBasis:
      typeof raw.calcBasis === 'string' ? raw.calcBasis : 'TimeWeighted',
    columnTagMap,
  };
}
