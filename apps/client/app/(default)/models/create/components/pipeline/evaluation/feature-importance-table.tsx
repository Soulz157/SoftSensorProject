import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  canRank,
  observationsPerFeature,
  rankFeatures,
  tailSummary,
} from '@/lib/feature-importance'
import type { RunFeatureImportance } from '@/services/model-draft'
import { EmptyPanel } from './empty-panel'

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * MODEL-FLOW-019-T16. Method label AND its own caveat, in one table — so a
 * fourth method (T14's permutation importance) extends this instead of
 * writing a second copy of a sentence. Caveat text is this feature's own
 * recorded findings 10 and 11, not reworded from memory:
 *
 * `coefficient`/`pls-coefficient` — finding 10: a per-feature weight (or,
 * for PLS, a projection onto latent components) comparable across features
 * only when the inputs are standardised; unranked otherwise (`canRank`,
 * enforced below this table, not restated here).
 *
 * `impurity` — finding 11: biased toward high-cardinality features, and on
 * this system's own data that bias is MEASURED, not theoretical
 * (MODEL-FLOW-020-T03's census: process tags ~1,000 distinct values against
 * a target's 32-97).
 */
interface MethodMeta {
  label: string
  caveat: string
}

const METHOD_META: Record<string, MethodMeta> = {
  impurity: {
    label: 'impurity',
    caveat:
      'Biased toward high-cardinality features — on this system’s own data, process tags carry roughly 1,000 distinct values against a target’s 32 to 97, so the ranking favours the finest-grained sensor over a genuinely predictive coarse one.',
  },
  coefficient: {
    label: 'coefficient',
    caveat:
      'A per-feature weight, comparable across features only when the inputs are standardised.',
  },
  'pls-coefficient': {
    label: 'PLS coefficient',
    caveat:
      'A projection onto latent components, not a per-input importance in the sense the other rows carry — comparable across features only when the inputs are standardised, same as an ordinary coefficient.',
  },
  // MODEL-FLOW-019-T32. Its own caveat, deliberately NOT impurity's wording:
  // the failure here is not cardinality bias but PARTIAL EFFECT. Rescaling by
  // std(X) removes the unit problem and nothing else — the figure is still a
  // linear, additive weight read at fixed values of every other feature, so
  // where two tags move together (tags in one control loop, by construction)
  // it splits credit between them rather than reporting either one's total.
  'standardized-coefficient': {
    label: 'standardized coefficient',
    caveat:
      'The coefficient expressed per one standard deviation of its own input, measured on the rows this model was fitted on — comparable across features without rescaling the data. It is still a linear, additive effect at fixed values of every other feature, so where two tags move together it splits credit between them rather than reporting either one’s total influence.',
  },
}

/** Exported for MODEL-FLOW-019-T31's sweep table, which names the seed
 *  ranking's method beside its own figures. Exported rather than copied: the
 *  whole reason METHOD_META is a table is that a label lives in ONE place. */
export function methodMetaOf(method: string): MethodMeta {
  return METHOD_META[method] ?? { label: method, caveat: '' }
}

/**
 * MODEL-FLOW-019-T09. Top 10 by importance, beneath the residual
 * diagnostics — AC22-AC27. `derivedFromTarget` flags a leakage-guard feature
 * where it ranks, read off the run's own manifest (never re-derived here);
 * `distinctLabelledValues`/`featureCount` feed AC26's observations-per-
 * feature arithmetic, `null` on a candidate-job run by design
 * (MODEL-FLOW-014-T06 — splitStats is never frozen for one).
 */
export function FeatureImportanceTable({
  importance,
  derivedFromTarget,
  distinctLabelledValues,
  distinctLabelledSource = null,
  distinctLabelledLoading = false,
}: {
  importance: RunFeatureImportance
  derivedFromTarget: string[] | null
  distinctLabelledValues: number | null
  /** Where that count came from, so an artifact-level read is not shown as
   *  this run's own frozen figure. */
  distinctLabelledSource?: 'run' | 'artifact' | null
  distinctLabelledLoading?: boolean
}) {
  const rankable = canRank(importance)
  const ranked = rankable ? rankFeatures(importance, 10) : []
  const tail = tailSummary(importance, 10)
  const derivedSet = new Set(derivedFromTarget ?? [])
  const obsPerFeature = observationsPerFeature(
    distinctLabelledValues,
    tail.totalCount,
  )
  const { label: methodLabel, caveat } = methodMetaOf(importance.method)

  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Feature importance
        </h3>
        <p className="text-xs text-muted-foreground">
          Measured by {methodLabel} — this figure is not comparable across
          methods, and the percentage is normalised within this run only.
          {caveat && ` ${caveat}`}
        </p>
      </div>

      {!rankable ? (
        // MODEL-FLOW-019-T32 restates the REASON. It used to say "over
        // unscaled inputs", which named a cause the artifact cannot actually
        // distinguish: what the run records is whether a fitted scaler covers
        // every feature. A partially scaled frame lands here too, and so does
        // a run whose image is too old to report a width to standardise by.
        <EmptyPanel>
          {importance.features.length} feature
          {importance.features.length === 1 ? '' : 's'} recorded, but not
          ranked: a {methodLabel} is comparable across features only when every
          feature carries a recorded scaling, and this run’s does not — so these
          numbers rank by unit, not by influence.
        </EmptyPanel>
      ) : (
        <div className="rounded-lg border border-border">
          <Table className="text-xs">
            {tail.totalCount > tail.shownCount && (
              // A statement about the table's own completeness, which is what
              // <caption> is for — and it keeps the denominator `% of total`
              // refers to beside the column that claims it.
              <TableCaption className="mb-3 px-3 text-xs">
                Top {tail.shownCount} of {tail.totalCount} features — the
                remaining {tail.totalCount - tail.shownCount} make up{' '}
                {formatPct(tail.tailShare)} of the total.
              </TableCaption>
            )}
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-9 px-3">#</TableHead>
                <TableHead className="h-9 px-3">Feature (X)</TableHead>
                <TableHead className="h-9 px-3 text-right">
                  Importance
                </TableHead>
                <TableHead
                  className="h-9 px-3 text-right"
                  title="Share of the summed importance of every feature this run used, not only the ten listed"
                >
                  % of total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map(row => (
                <TableRow key={row.name}>
                  <TableCell className="px-3 py-2 text-muted-foreground">
                    {row.rank}
                  </TableCell>
                  <TableCell className="px-3 py-2 font-medium text-foreground">
                    {row.name}
                    {derivedSet.has(row.name) && (
                      // Neutral, never a warning tone: a target-derived
                      // feature ranking high is a FINDING a reader must see
                      // (AC24), not a fault — and red/amber are reserved for
                      // workspace and plant status in this project.
                      <Badge
                        variant="secondary"
                        className="ml-2 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                      >
                        target-derived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right font-mono tabular-nums">
                    {row.importance.toFixed(4)}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatPct(row.share)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* MODEL-FLOW-019-T31. `distinctLabelledSource` names WHERE the
          denominator came from. It used to read only this run's frozen
          splitStats, which is null for 187 of 260 SUCCEEDED runs (a
          candidate-job run freezes none by design), so this line said "not
          recorded" on most runs a reader opens. The figure is now resolved
          once for the step, and an artifact-level read says so rather than
          passing itself off as this run's own record. */}
      <p className="text-xs text-muted-foreground">
        {obsPerFeature !== null
          ? `${obsPerFeature.toFixed(1)} distinct labelled observations per feature${
              distinctLabelledSource === 'artifact'
                ? ', counted on this run’s artifact and target — this run froze no split record of its own.'
                : '.'
            }`
          : distinctLabelledLoading
            ? 'Counting the distinct labelled values behind this run…'
            : 'Observations per feature: not recorded for this run.'}
      </p>
    </section>
  )
}
