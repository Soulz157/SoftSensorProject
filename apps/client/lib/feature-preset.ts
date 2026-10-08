import { tokenizeColumns } from '@/lib/formula'
import type { FeatureConfig, FormulaFeature } from '@/lib/feature-engineering'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import type { ConditionalRule, RangeExclusion } from '@/lib/precleanse'
import type { CutoffOp } from '@/types/cutoff'
import { TagResolution } from '@/hooks/dataset/use-tag-resolution'

/**
 * Pure logic for applying an imported soft-sensor preset to the dataset wizard.
 *
 * No React, no fetching — `services/feature-preset.ts` and
 * `hooks/dataset/use-feature-presets.ts` own those. Everything here is a
 * derivation over a preset document and the Step-1 tag table.
 *
 * Wire shapes stay snake_case: these objects come straight from object storage
 * via the API and are not remapped on the way in, so a rename upstream fails
 * visibly rather than silently reading `undefined`.
 */

// ---------------------------------------------------------------------------
// Document shapes (mirror apps/python/services/preset_parser.py)
// ---------------------------------------------------------------------------

/**
 * `range` resolved to a numeric bound (DS-LAKE-020-T02, parsed server-side at
 * import time). `null` on a preset imported before this field existed
 * (schema_version 1) — re-import to enable range cutoffs for it.
 */
export interface ParsedRange {
  kind: 'none' | 'closed' | 'lower' | 'upper'
  min: number | null
  max: number | null
  unit: string | null
  raw: string
}

export interface PresetFeature {
  /** `raw_tag` names an existing column; `equation` derives a new one. */
  type: 'equation' | 'raw_tag'
  /** Engineered column name for an equation; the tag itself for a raw tag. */
  name: string
  /** Original expression over real tag names. Null for a raw tag. */
  formula: string | null
  description: string
  range: string
  range_parsed: ParsedRange | null
  relation: string
  required_base_tags: string[]
  /**
   * Ambiguities a human should confirm: a tag whose name contains a slash,
   * or a `range` cell that looked like an attempted bound but could not be
   * parsed.
   */
  parse_warnings: string[]
}

export interface PresetDocument {
  schema_version: number
  preset_id: string
  unit: string
  config_no: number
  name: string
  plant: string
  sampling_point: string
  /** The lab measurement this preset predicts. Always a `.lab` tag. */
  target_y: string
  features: PresetFeature[]
  /** Deduped union across every feature. */
  required_base_tags: string[]
  /** True when the sheet declared a target but listed no X rows. */
  incomplete: boolean
}

/** One row of the metadata index, as the list endpoint returns it. */
export interface PresetSummary {
  id: string
  presetId: string
  unit: string
  configNo: number
  name: string
  samplingPoint: string | null
  targetY: string
  objectKey: string
  equationCount: number
  rawTagCount: number
  requiredBaseTags: string[]
  incomplete: boolean
}

export type TagHealth = (tag: string) => 'good' | 'bad' | 'unknown'

/** Step 1: a loaded row wins, then PI resolution — same order as `compareTags`. */
export function lookupHealth(lookup: TagLookup): TagHealth {
  const status = new Map<string, 'good' | 'bad'>()
  // First writer wins, so a healthy row is not shadowed by a later duplicate
  // in error — same reason `compareTags` builds its maps this way.
  for (const row of lookup.rows) {
    if (status.has(row.tagName)) continue
    if (row.status === 'good') status.set(row.tagName, 'good')
    else if (row.status === 'bad') status.set(row.tagName, 'bad')
  }
  return tag =>
    status.get(tag) ?? (lookup.resolved.has(tag) ? 'good' : 'unknown')
}

/**
 * Step 3.2 onward: membership in the fetched dataset IS health. A tag only
 * reaches `dwRawDatasetAtom` by surviving Step-1 validation and a successful
 * fetch, so there is no `bad` to report here — anything absent is `unknown`.
 */
export function datasetHealth(tags: Iterable<string>): TagHealth {
  const present = new Set(tags)
  return tag => (present.has(tag) ? 'good' : 'unknown')
}

/**
 * Shutdown/turnaround cut config from the SD&TA sheet, mirroring
 * `apps/python/services/preset_parser.py:sdta_document()`. Ranges are
 * ISO-8601 UTC (already converted from Excel serials server-side); consuming
 * this into `dwExclusionsAtom` / `dwConditionalRulesAtom` is FP-8 — this type
 * exists now so `dwSdtaConfigAtom` has a real shape rather than a placeholder.
 */
export interface SdtaConfig {
  ranges: Array<{ from: string; to: string }>
  conditions: Array<{ tag: string; op: string; value: number }>
}

// ---------------------------------------------------------------------------
// Tag comparison
// ---------------------------------------------------------------------------

/**
 * Why a required tag is not usable.
 *
 * `error` is NOT a flavour of `missing`. The tag is present in the catalogue
 * but its Step-1 row failed validation, so remapping cannot fix it — the user
 * has to repair the tag itself. Collapsing the two would send them looking for
 * a tag that is already on screen.
 */
export type TagCheckStatus = 'matched' | 'error' | 'missing'

export interface TagLookup {
  resolved: Map<string, TagResolution>
  rows: DatasetTagRow[]
}

export interface TagCheck {
  tag: string
  status: TagCheckStatus
  usedIn: string[]
  usedBy: Array<'equation' | 'raw_tag'>
  mappedTo: string | null
  errorReason?: string
  isLabTag: boolean
  /**
   * The PI source this tag lives on — null for a manual row or a missing tag.
   * Apply uses it to build the selection key directly instead of guessing,
   * which it had to do when only the name was available.
   */
  sourceId: string | null
}

export interface TagComparison {
  checks: TagCheck[]
  matched: number
  /** Present but the Step-1 row is in error. Blocks apply, same as missing. */
  unhealthy: number
  missing: number
  /** 0-100. 100 only when every required tag is matched AND healthy. */
  readyPct: number
  /** True when nothing blocks applying the preset. */
  ready: boolean
}

/** Lab tags are sampled by hand, so they are absent from a PI-only catalogue. */
export function isLabTag(tag: string): boolean {
  return tag.toLowerCase().endsWith('.lab')
}

/** Case- and whitespace-insensitive key, for the near-miss fallback. */
function normalize(tag: string): string {
  return tag.trim().toLowerCase()
}

/**
 * Compare a preset's required base tags against the plant.
 *
 * Resolution order is deliberate: a loaded row wins over a PI resolution,
 * because the row is the only thing that knows a tag is present-but-broken.
 * Falling through to `resolved` is what makes this work under pagination.
 */
export function compareTags(
  doc: PresetDocument,
  lookup: TagLookup,
  overrides: Record<string, string> = {},
): TagComparison {
  const { resolved, rows } = lookup

  const byExact = new Map<string, DatasetTagRow>()
  const byNormalized = new Map<string, DatasetTagRow>()
  for (const row of rows) {
    // First writer wins: a healthy row must not be shadowed by a later
    // duplicate in error, which would report a usable tag as broken.
    if (!byExact.has(row.tagName)) byExact.set(row.tagName, row)
    const key = normalize(row.tagName)
    if (!byNormalized.has(key)) byNormalized.set(key, row)
  }

  const resolvedNormalized = new Map<string, [string, TagResolution]>()
  for (const [name, res] of resolved) {
    const key = normalize(name)
    if (!resolvedNormalized.has(key)) resolvedNormalized.set(key, [name, res])
  }

  const required = new Map<
    string,
    { usedIn: string[]; usedBy: Set<'equation' | 'raw_tag'> }
  >()
  for (const feature of doc.features) {
    for (const tag of feature.required_base_tags) {
      const entry = required.get(tag) ?? { usedIn: [], usedBy: new Set() }
      if (!entry.usedIn.includes(feature.name)) entry.usedIn.push(feature.name)
      entry.usedBy.add(feature.type)
      required.set(tag, entry)
    }
  }

  const checks: TagCheck[] = [...required.entries()].map(([tag, use]) => {
    const wanted = overrides[tag] ?? tag
    const base = {
      tag,
      usedIn: use.usedIn,
      usedBy: [...use.usedBy],
      isLabTag: isLabTag(tag),
    }

    // 1) A row on the loaded page — the only place `bad` is knowable.
    const row = byExact.get(wanted) ?? byNormalized.get(normalize(wanted))
    if (row) {
      const mappedTo = row.tagName !== tag ? row.tagName : null
      if (row.status === 'bad') {
        return {
          ...base,
          status: 'error' as const,
          mappedTo,
          errorReason: row.errorReason,
          sourceId: row.sourceId ?? null,
        }
      }
      return {
        ...base,
        status: 'matched' as const,
        mappedTo,
        sourceId: row.sourceId ?? null,
      }
    }

    // 2) Not on this page — ask what PI said about the name.
    const direct = resolved.get(wanted)
    if (direct) {
      return {
        ...base,
        status: 'matched' as const,
        mappedTo: wanted !== tag ? wanted : null,
        sourceId: direct.sourceId,
      }
    }
    const near = resolvedNormalized.get(normalize(wanted))
    if (near) {
      const [actualName, res] = near
      return {
        ...base,
        status: 'matched' as const,
        mappedTo: actualName !== tag ? actualName : null,
        sourceId: res.sourceId,
      }
    }

    return {
      ...base,
      status: 'missing' as const,
      mappedTo: null,
      sourceId: null,
    }
  })

  const matched = checks.filter(c => c.status === 'matched').length
  const unhealthy = checks.filter(c => c.status === 'error').length
  const missing = checks.filter(c => c.status === 'missing').length

  return {
    checks,
    matched,
    unhealthy,
    missing,
    readyPct:
      checks.length === 0 ? 100 : Math.round((matched / checks.length) * 100),
    ready: matched === checks.length,
  }
}

/**
 * Whether Apply may proceed.
 *
 * The target is deliberately NOT part of this. Every `Y` in the source workbook
 * is a `.lab` tag, so requiring it would block every preset against a PI-only
 * catalogue. Its absence is surfaced at Save instead, loudly — see the wizard's
 * Step 5.
 */
export function canApply(
  doc: PresetDocument,
  comparison: TagComparison,
): boolean {
  return !doc.incomplete && comparison.ready
}

// ---------------------------------------------------------------------------
// Preset -> feature configs
// ---------------------------------------------------------------------------

/** Tags a preset needs in the dataset, with any overrides applied. */
export function requiredDatasetTags(
  doc: PresetDocument,
  overrides: Record<string, string> = {},
): string[] {
  const tags = new Set<string>()
  for (const tag of doc.required_base_tags) tags.add(overrides[tag] ?? tag)
  return [...tags]
}

/** What applying a preset changes about the wizard's Step-1 selection. */
export interface PresetApplication {
  /**
   * Selection keys (`${sourceId}::${tagName}`) to union into the selection.
   * Keys, not names: selection has to survive paging, and the same tag name
   * on two plants must stay distinguishable.
   */
  selectionKeys: string[]
  targetTag: string
  targetInCatalogue: boolean
  /** Matched but with no PI source (manual row) — cannot be keyed. */
  unselectable: string[]
}

/**
 * Compute the Step-1 selection change for Apply Mapping. Pure — the caller
 * (the tag table) owns writing the result into `nav.setSelectedTags` and
 * `dwTargetTagAtom`.
 *
 * The target is unioned in ONLY when it already resolves to a healthy row.
 * Every workbook target is a `.lab` tag, absent from a PI catalogue by
 * construction, so requiring it here would mean Apply always drops it. `rows`
 * must carry per-tag status for the same reason `compareTags` does: a `string[]`
 * cannot distinguish a healthy row from one in error.
 */
export function planPresetApplication(
  document: PresetDocument,
  comparison: TagComparison,
  resolved: Map<string, TagResolution>,
): PresetApplication {
  const keys: string[] = []
  const unselectable: string[] = []

  for (const check of comparison.checks) {
    if (check.status !== 'matched') continue
    const name = check.mappedTo ?? check.tag
    if (check.sourceId) keys.push(`${check.sourceId}::${name}`)
    else unselectable.push(name)
  }

  // Every workbook target is a `.lab` tag, absent from PI by construction, so
  // it never blocks apply — union it in only when PI actually resolved it.
  const targetRes = resolved.get(document.target_y)
  if (targetRes) keys.push(`${targetRes.sourceId}::${document.target_y}`)

  return {
    selectionKeys: keys,
    targetTag: document.target_y,
    targetInCatalogue: Boolean(targetRes),
    unselectable,
  }
}

/**
 * Turn a preset's equations into feature configs for Step 4.
 *
 * Raw-tag features are intentionally NOT included: they name columns that
 * already exist, so engineering them would duplicate a column rather than
 * derive one. They reach the dataset through the tag selection instead.
 *
 * Tokenising against the preset's OWN base tags — rather than the fetched
 * dataset's columns — is what lets this run at Step 1, before any rows exist.
 * Nothing is evaluated here: `dwFeaturedDatasetAtom` derives from the raw
 * dataset, which is empty until Step 2 fetches, so these sit inert until then.
 */
export function toFeatureConfigs(
  doc: PresetDocument,
  overrides: Record<string, string> = {},
  makeId: () => string = () => crypto.randomUUID(),
): FeatureConfig[] {
  const configs: FeatureConfig[] = []

  for (const feature of doc.features) {
    if (feature.type !== 'equation' || !feature.formula) continue

    // Longest-first matching inside tokenizeColumns needs every candidate
    // column present, so pass the feature's own tags rather than the union.
    const columns = feature.required_base_tags
    const { aliasExpr, vars } = tokenizeColumns(feature.formula, columns)

    // Re-point each alias at the overridden column, leaving the expression
    // untouched — the alias form is exactly what makes that substitution safe.
    const mapped: Record<string, string> = {}
    for (const [alias, column] of Object.entries(vars)) {
      mapped[alias] = overrides[column] ?? column
    }

    const config: FormulaFeature = {
      id: makeId(),
      kind: 'formula',
      name: feature.name,
      expr: aliasExpr,
      vars: mapped,
      // Shown in the Step-4 list, so the engineer sees what they wrote in the
      // workbook rather than `c0*c1/(c2+c1)`.
      display: feature.formula,
    }
    configs.push(config)
  }

  return configs
}

// ---------------------------------------------------------------------------
// SD&TA (shutdown/turnaround) cut config -> Step-3 cleaning rules
// ---------------------------------------------------------------------------

/**
 * One condition the parser produced but this plan could not carry through.
 * Carries `op`/`value` (not just `tag`) so the UI can show the FULL
 * condition — "GG203.PV < 1700, not applied: tag not in this dataset" — not
 * just the bare tag name a user has no way to recognise on its own.
 */
export interface DroppedSdtaCondition {
  tag: string
  op: string
  value: number
  reason: string
}

export interface SdtaApplication {
  /** One per shutdown/turnaround window — time-only, no value bound. */
  exclusions: RangeExclusion[]
  conditionalRules: ConditionalRule[]
  /** Conditions refused rather than silently miscompiled. */
  droppedConditions: DroppedSdtaCondition[]
}

const CUTOFF_OPS: ReadonlySet<string> = new Set([
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '!=',
])

/** Narrows a wire-format string op to the client's `CutoffOp` union. */
function isCutoffOp(op: string): op is CutoffOp {
  return CUTOFF_OPS.has(op)
}

/**
 * Turn a parsed SD&TA config into Step-3 cleaning rules.
 *
 * Pure — the caller writes the result into `nav.setExclusions` /
 * `nav.setConditionalRules`. Two things are refused rather than passed
 * through, both surfaced in `droppedConditions` instead of failing silently:
 *
 * - An operator outside `CutoffOp`. The parser only ever emits `<`, `<=`,
 *   `>`, `>=`, `==`, but this is server output crossing a network boundary,
 *   not a compile-time guarantee — an unrecognised op must not become a
 *   `ConditionalRule` the cleaning pipeline cannot interpret.
 * - A tag not present as a healthy row. A condition on a column that doesn't
 *   exist (or is known-bad) is not a rule, it's a dangling reference — same
 *   reasoning as `compareTags` refusing to treat an errored row as usable.
 */
export function planSdtaApplication(
  sdta: SdtaConfig,
  health: TagHealth | TagLookup,
  makeId: () => string = () => crypto.randomUUID(),
): SdtaApplication {
  // A `TagLookup` is an object, a `TagHealth` a function — no discriminant
  // needed, and the old two-arg call sites keep working unchanged.
  const healthOf: TagHealth =
    typeof health === 'function' ? health : lookupHealth(health)

  const exclusions: RangeExclusion[] = sdta.ranges.map(range => ({
    time: { from: range.from, to: range.to },
    value: null,
  }))

  const conditionalRules: ConditionalRule[] = []
  const droppedConditions: DroppedSdtaCondition[] = []

  for (const condition of sdta.conditions) {
    if (!isCutoffOp(condition.op)) {
      droppedConditions.push({
        tag: condition.tag,
        op: condition.op,
        value: condition.value,
        reason: `Unsupported operator "${condition.op}"`,
      })
      continue
    }
    const status = healthOf(condition.tag)
    if (status === 'bad') {
      droppedConditions.push({
        tag: condition.tag,
        op: condition.op,
        value: condition.value,
        reason: 'Tag is in error',
      })
      continue
    }
    if (status === 'unknown') {
      droppedConditions.push({
        tag: condition.tag,
        op: condition.op,
        value: condition.value,
        reason: 'Tag not in the selected dataset',
      })
      continue
    }
    conditionalRules.push({
      id: makeId(),
      tag: condition.tag,
      op: condition.op,
      value: condition.value,
      action: 'drop_row',
      enabled: true,
    })
  }

  return { exclusions, conditionalRules, droppedConditions }
}
