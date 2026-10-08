import {
  DroppedSdtaCondition,
  planSdtaApplication,
  SdtaConfig,
  type TagHealth,
} from './feature-preset'
import { ConditionalRule, RangeExclusion } from './precleanse'

export type { TagHealth }

/** One SD&TA sheet, as imported. Multiple presets can be staged at once. */
export interface SdtaPreset {
  id: string
  name: string
  config: SdtaConfig
}

export type SdtaCombine = 'all' | 'any'

/** A range the parser emitted that could not become a span. */
export interface DroppedSdtaRange {
  from: string
  to: string
  reason: string
}

export interface SdtaSelectionPlan {
  exclusions: RangeExclusion[]
  conditionalRules: ConditionalRule[]
  droppedConditions: DroppedSdtaCondition[]
  droppedRanges: DroppedSdtaRange[]
  /** `any` over presets that share no overlapping window — cuts nothing. */
  emptyIntersection: boolean
}

interface Span {
  /**
   * The ORIGINAL strings, never a normalised re-emission.
   *
   * `runPipeline` compares timestamps LEXICOGRAPHICALLY
   * (`r.timestamp >= b.from`), so round-tripping through epoch millis and
   * back via `toISOString()` would force `…T00:00:00.000Z` and silently stop
   * matching rows whose format differs (no millis, or a `+07:00` offset).
   * Epoch is used below only to validate and to order — never to emit.
   */
  from: string
  to: string
}

const maxStr = (a: string, b: string) => (a > b ? a : b)
const minStr = (a: string, b: string) => (a < b ? a : b)

/** Sort + merge overlaps, so the two-pointer intersect below stays correct. */
function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of [...spans].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to) last.to = maxStr(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

function intersectSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const from = maxStr(a[i]!.from, b[j]!.from)
    const to = minStr(a[i]!.to, b[j]!.to)
    // Strict: `runPipeline`'s band test is inclusive on BOTH ends, so a
    // zero-width overlap would still drop the row sitting on that instant. In
    // `any` mode — where adding a preset may only ever RESTORE rows — a shared
    // boundary is not a cut.
    if (from < to) out.push({ from, to })
    if (a[i]!.to < b[j]!.to) i++
    else j++
  }
  return out
}

function toSpans(
  ranges: SdtaConfig['ranges'],
  dropped: DroppedSdtaRange[],
): Span[] {
  const spans: Span[] = []
  for (const r of ranges) {
    const from = Date.parse(r.from)
    const to = Date.parse(r.to)
    if (Number.isNaN(from) || Number.isNaN(to)) {
      dropped.push({ ...r, reason: 'Unparseable timestamp' })
      continue
    }
    if (from >= to) {
      dropped.push({ ...r, reason: 'Range ends before it starts' })
      continue
    }
    spans.push({ from: r.from, to: r.to })
  }
  return mergeSpans(spans)
}

function sameRule(a: ConditionalRule, b: ConditionalRule): boolean {
  return (
    a.tag === b.tag &&
    a.op === b.op &&
    a.value === b.value &&
    a.action === b.action
  )
}

function sdtaSignature(config: SdtaConfig): string {
  const r = config.ranges.map(x => `${x.from}|${x.to}`).sort()
  const c = config.conditions.map(x => `${x.tag}|${x.op}|${x.value}`).sort()
  return [...r, '::', ...c].join('~')
}

/** True when this sheet declares nothing to cut — staging it is pointless. */
export function isEmptySdta(config: SdtaConfig): boolean {
  return config.ranges.length === 0 && config.conditions.length === 0
}

/**
 * Takes the display name directly rather than a `PresetSummary` — SD&TA
 * belongs to the IMPORT, not to any one preset (a user can stage the cut
 * with no preset selected), so the caller resolves the name from whichever
 * of the two it actually has: `sdtaPresetName(summary)` when a preset is
 * selected, or the import's own file name when none is (DS-LAKE-013).
 * Identity is unaffected either way — `id` is content-addressed off
 * `sdtaSignature(config)`, so two imports declaring the same windows still
 * dedupe regardless of what either was named.
 */
export function toSdtaPreset(config: SdtaConfig, name: string): SdtaPreset {
  return {
    id: `sdta:${sdtaSignature(config)}`,
    name,
    config,
  }
}

/**
 * Combine the selected presets into one set of Step-3 cuts.
 *
 * Pure. Per-preset planning still goes through `planSdtaApplication`, so the
 * operator/health refusals stay in one place — this only decides how the
 * surviving windows and rules stack.
 */
export function planSdtaSelection(
  presets: SdtaPreset[],
  selectedIds: string[],
  combine: SdtaCombine,
  health: TagHealth,
  makeId: () => string = () => crypto.randomUUID(),
): SdtaSelectionPlan {
  const chosen = presets.filter(p => selectedIds.includes(p.id))
  const plans = chosen.map(p => ({
    preset: p,
    plan: planSdtaApplication(p.config, health, makeId),
  }))

  const droppedConditions = plans.flatMap(({ plan }) => plan.droppedConditions)
  const droppedRanges: DroppedSdtaRange[] = []

  if (plans.length === 0) {
    return {
      exclusions: [],
      conditionalRules: [],
      droppedConditions,
      droppedRanges,
      emptyIntersection: false,
    }
  }

  // Dedupe: two presets covering the same unit often carry an identical
  // condition, and two copies of one rule is noise in the sidebar, not a
  // stricter cut.
  const rules: ConditionalRule[] = []
  for (const { plan } of plans) {
    for (const r of plan.conditionalRules) {
      if (!rules.some(x => sameRule(x, r))) rules.push({ ...r, source: 'sdta' })
    }
  }

  if (combine === 'all' || plans.length === 1) {
    // Passed through untouched — the ISO strings stay byte-identical to what
    // the parser produced, which is what keeps the lexicographic band test in
    // `runPipeline` matching.
    return {
      exclusions: plans.flatMap(({ plan }) =>
        plan.exclusions.map(e => ({ ...e, source: 'sdta' as const })),
      ),
      conditionalRules: rules,
      droppedConditions,
      droppedRanges,
      emptyIntersection: false,
    }
  }

  let spans = toSpans(plans[0]!.preset.config.ranges, droppedRanges)
  for (const { preset } of plans.slice(1)) {
    spans = intersectSpans(spans, toSpans(preset.config.ranges, droppedRanges))
  }

  // A condition is a value predicate with no time extent, so there is nothing
  // to intersect it against. Carrying one through would apply preset A's
  // threshold to a period preset B declared valid — silently reintroducing the
  // AND this mode exists to avoid.
  const conditionDrops: DroppedSdtaCondition[] = rules.map(r => ({
    tag: r.tag,
    op: r.op,
    value: typeof r.value === 'number' ? r.value : 0,
    reason: 'Conditions cannot be combined across presets in Any mode',
  }))

  return {
    exclusions: spans.map(s => ({
      time: { from: s.from, to: s.to },
      value: null,
      source: 'sdta' as const,
    })),
    conditionalRules: [],
    droppedConditions: [...droppedConditions, ...conditionDrops],
    droppedRanges,
    emptyIntersection: spans.length === 0,
  }
}

/**
 * Add or replace one preset by id, preserving order for existing entries.
 *
 * Replace-in-place rather than remove-then-push: the card's checkbox order is
 * the array order, so a re-import would otherwise jump the preset to the
 * bottom of a list the user is mid-way through selecting.
 */
export function upsertSdtaPreset(
  presets: SdtaPreset[],
  next: SdtaPreset,
): SdtaPreset[] {
  const idx = presets.findIndex(p => p.id === next.id)
  if (idx === -1) return [...presets, next]
  const out = [...presets]
  out[idx] = next
  return out
}

/** Display label for a preset, from the metadata row that carried it. */
export function sdtaPresetName(summary: {
  unit: string
  configNo: number
  name: string
}): string {
  return `${summary.unit} · Config ${summary.configNo} — ${summary.name}`
}

/** Swap the preset-authored cuts for `next`, leaving hand-drawn ones alone. */
export function replacePresetExclusions(
  current: RangeExclusion[],
  next: RangeExclusion[],
): RangeExclusion[] {
  return [...current.filter(e => e.source !== 'sdta'), ...next]
}

export function replacePresetRules(
  current: ConditionalRule[],
  next: ConditionalRule[],
): ConditionalRule[] {
  return [...current.filter(r => r.source !== 'sdta'), ...next]
}

/** Stable signature of the preset-authored cuts currently in effect. */
export function presetCutSignature(
  exclusions: RangeExclusion[],
  rules: ConditionalRule[],
): string {
  const w = exclusions
    .filter(e => e.source === 'sdta')
    .map(e => `w|${e.time?.from}|${e.time?.to}`)
  const c = rules
    .filter(r => r.source === 'sdta')
    .map(r => `c|${r.tag}|${r.op}|${r.value}|${r.action}`)
  return [...w, ...c].sort().join('~')
}
