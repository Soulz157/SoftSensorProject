import type { RunCvFolds } from '@/services/model-draft'

/**
 * MODEL-FLOW-016-T11. The REAL per-fold table — post-training r2/rmse/mae
 * beside each fold's own row counts, distinct from T10's `CvFoldPlan`
 * (Step 3's pre-training `/split-stats` plan; same row counts, no metrics
 * yet, because training had not run). Available as soon as `cvFoldsKey` is
 * set — training writes `cv_folds.json` before scoring exists as a
 * concept — so this renders in the awaiting-scoring/scoring state too, not
 * only once the model is scored: it is how a reader spots the fold that
 * looks worst, which is the whole reason to still trust (or not) the
 * configuration while its refit is waiting to be scored.
 */
export function CvFoldTable({ cvFolds }: { cvFolds: RunCvFolds }) {
  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Per-fold configuration metrics
        </h3>
        <p className="text-xs text-muted-foreground">
          {cvFolds.n_splits} expanding fold{cvFolds.n_splits === 1 ? '' : 's'} —
          the configuration&apos;s own numbers, never the shipped model&apos;s
          score above. A fold far worse than its neighbours is a real finding —
          but check its Train rows first: an EXPANDING window makes fold 1
          systematically train on the least data, so a worse fold 1 can be a
          data-volume artefact rather than a regime change (MODEL-FLOW-016-T03).
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fold</th>
              <th className="px-3 py-2 font-medium">Cut</th>
              <th className="px-3 py-2 font-medium text-right">Train rows</th>
              <th className="px-3 py-2 font-medium text-right">Test rows</th>
              <th className="px-3 py-2 font-medium text-right">R²</th>
              <th className="px-3 py-2 font-medium text-right">RMSE</th>
              <th className="px-3 py-2 font-medium text-right">MAE</th>
            </tr>
          </thead>
          <tbody>
            {cvFolds.folds.map(fold => (
              <tr
                key={fold.fold}
                className={fold.fold > 1 ? 'border-t border-border' : undefined}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {fold.fold}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(fold.cut_timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.train_rows.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.test_rows.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.r2.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.rmse.toFixed(3)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {fold.mae.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
