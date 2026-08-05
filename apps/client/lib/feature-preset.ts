import { tokenizeColumns } from '@/lib/formula'
import type { FeatureConfig, FormulaFeature } from '@/lib/feature-engineering'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import type { ConditionalRule, RangeExclusion } from '@/lib/precleanse'
import type { CutoffOp } from '@/types/cutoff'

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

export interface PresetFeature {
  /** `raw_tag` names an existing column; `equation` derives a new one. */
  type: 'equation' | 'raw_tag'
  /** Engineered column name for an equation; the tag itself for a raw tag. */
  name: string
  /** Original expression over real tag names. Null for a raw tag. */
  formula: string | null
  description: string
  range: string
  relation: string
  required_base_tags: string[]
  /** Ambiguities a human should confirm (a tag whose name contains a slash). */
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

export interface TagCheck {
  /** The tag the preset asked for. */
  tag: string
  status: TagCheckStatus
  /** Feature names that need this tag. */
  usedIn: string[]
  /** Whether it is needed by an equation, a raw-tag feature, or both. */
  usedBy: Array<'equation' | 'raw_tag'>
  /**
   * The dataset tag actually resolved to, when it differs from `tag` — either a
   * case/whitespace variant or a user override. Null when they are identical.
   */
  mappedTo: string | null
  /** Why the Step-1 row is unusable. Only set when `status === 'error'`. */
  errorReason?: string
  /**
   * A lab measurement (`.lab`/`.Lab`), which lives in manual sample data rather
   * than the PI historian. A missing one means "this data has not been joined
   * yet", not "you typed the tag wrong", and the UI must say so — otherwise the
   * first preset a user opens is blocked with a misleading explanation.
   */
  isLabTag: boolean
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
 * Compare a preset's required base tags against the Step-1 tag table.
 *
 * Takes ROWS, not tag names. The distinction is load-bearing: the table
 * includes rows whose status is `error`, and a plain `string[]` cannot tell
 * them apart from healthy ones. Comparing against names alone reports a broken
 * tag as Matched, drives the missing count to zero, and enables Apply — which
 * then queues a fetch for a tag already known to be bad.
 *
 * @param overrides Map of required tag → chosen dataset tag, from the "map to…"
 * control. Only consulted when the tag does not resolve on its own.
 */
export function compareTags(
  doc: PresetDocument,
  rows: DatasetTagRow[],
  overrides: Record<string, string> = {},
): TagComparison {
  const byExact = new Map<string, DatasetTagRow>()
  const byNormalized = new Map<string, DatasetTagRow>()
  for (const row of rows) {
    // First writer wins: a healthy row must not be shadowed by a later
    // duplicate in error, which would report a usable tag as broken.
    if (!byExact.has(row.tagName)) byExact.set(row.tagName, row)
    const key = normalize(row.tagName)
    if (!byNormalized.has(key)) byNormalized.set(key, row)
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
    const override = overrides[tag]
    const row =
      (override ? byExact.get(override) : undefined) ??
      byExact.get(tag) ??
      byNormalized.get(normalize(tag))

    const resolved = row?.tagName ?? null
    const base = {
      tag,
      usedIn: use.usedIn,
      usedBy: [...use.usedBy],
      mappedTo: resolved && resolved !== tag ? resolved : null,
      isLabTag: isLabTag(tag),
    }

    if (!row) return { ...base, status: 'missing' as const }
    if (row.status === 'error') {
      return {
        ...base,
        status: 'error' as const,
        errorReason: row.errorReason,
      }
    }
    return { ...base, status: 'matched' as const }
  })

  const matched = checks.filter(c => c.status === 'matched').length
  const unhealthy = checks.filter(c => c.status === 'error').length
  const missing = checks.filter(c => c.status === 'missing').length

  return {
    checks,
    matched,
    unhealthy,
    missing,
    // An empty requirement list is vacuously ready, but `incomplete` presets
    // are gated separately — see `canApply`.
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
  /** Current selection unioned with the preset's required tags. */
  selectedTags: string[]
  /** The preset's target (Y) — recorded regardless of whether it is present. */
  targetTag: string
  /** Whether the target already exists as a healthy row. Purely informational
   * for the caller (e.g. to skip a "not in this dataset" toast); the target is
   * never added to `selectedTags` when this is false. */
  targetInCatalogue: boolean
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
  requiredTags: string[],
  currentSelectedTags: string[],
  rows: DatasetTagRow[],
): PresetApplication {
  const next = new Set(currentSelectedTags)
  for (const tag of requiredTags) next.add(tag)

  const targetInCatalogue = rows.some(
    r => r.tagName === document.target_y && r.status === 'good',
  )
  if (targetInCatalogue) next.add(document.target_y)

  return {
    selectedTags: [...next],
    targetTag: document.target_y,
    targetInCatalogue,
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

/** One condition the parser produced but this plan could not carry through. */
export interface DroppedSdtaCondition {
  tag: string
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
  rows: DatasetTagRow[],
  makeId: () => string = () => crypto.randomUUID(),
): SdtaApplication {
  const exclusions: RangeExclusion[] = sdta.ranges.map(range => ({
    time: { from: range.from, to: range.to },
    value: null,
  }))

  const healthyTags = new Set(
    rows.filter(r => r.status === 'good').map(r => r.tagName),
  )

  const conditionalRules: ConditionalRule[] = []
  const droppedConditions: DroppedSdtaCondition[] = []

  for (const condition of sdta.conditions) {
    if (!isCutoffOp(condition.op)) {
      droppedConditions.push({
        tag: condition.tag,
        reason: `Unsupported operator "${condition.op}"`,
      })
      continue
    }
    if (!healthyTags.has(condition.tag)) {
      droppedConditions.push({
        tag: condition.tag,
        reason: 'Tag not in this dataset',
      })
      continue
    }
    conditionalRules.push({
      id: makeId(),
      tag: condition.tag,
      op: condition.op,
      value: condition.value,
      action: 'drop',
      enabled: true,
    })
  }

  return { exclusions, conditionalRules, droppedConditions }
}
