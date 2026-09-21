/**
 * MODEL-SERVE-012-T01. THE REFERENCE residual SD for a model version — the
 * number the live monitoring verdict is graded against.
 *
 * WHY A FROZEN REFERENCE AT ALL. `lib/residual-sd-health.ts` asks "is the
 * model's error spread bigger than it used to be". Answering that with an SD
 * recomputed from the same residuals being graded is not a weaker test, it is
 * NO test: multiply every live residual by ten and the ratio to its own SD is
 * unchanged. The comparison needs one side held still, and the run's own
 * test-split residual SD is the honest choice — it is what the model's error
 * looked like when someone accepted it.
 *
 * NOT A NEW METRIC. `sd` ("Residual standard deviation") is already one of
 * the four keys in `lib/metric-registry.ts`, already marked backfillable —
 * computable from stored (actual, predicted) pairs with no re-fit. This
 * module locates that value on a stored metrics blob; it computes nothing.
 */

/** Same shape `model-retrain.authorized.service.ts` uses to read a metrics
 *  blob: unknown in, null out, never a throw on a malformed column. */
function readMetric(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The key this system writes the reference SD under, on a training run's
 *  `metrics` blob — carried to `ModelVersion.metrics` for free by the
 *  existing copy in `lib/model-version-from-run.ts`. */
export const RESIDUAL_SD_METRIC_KEY = 'sd';

/**
 * The reference residual SD, or null when this version cannot supply one.
 *
 * PRECEDENCE, and each step's reason:
 *
 *   1. `sd` — the registry's own key. A run scored after MODEL-SERVE-012 has
 *      it; this is the intended path.
 *   2. `residual_sd` — python's spelling (`artifact_service.run_predictions`
 *      returns `residual_sd`). Accepted so a blob written straight from that
 *      response is not silently treated as having no baseline.
 *   3. `rmse` — THE FALLBACK, for every version scored before this existed.
 *      Deliberate and safe in one direction only: rmse = sqrt(sd² + bias²),
 *      so it is >= sd, always. A fallback baseline is therefore WIDER than
 *      the true one, which makes the ratio SMALLER and the verdict QUIETER.
 *      It can miss a real degradation; it cannot invent one. That asymmetry
 *      is the whole reason a fallback is allowed here at all.
 *
 * NULL IS A REAL ANSWER, not an error and not a zero. A caller must map it to
 * UNKNOWN — "no evidence" — and never to OK. Zero and negatives are rejected
 * with it: a zero baseline makes every ratio infinite, which would alarm on
 * every model whose run recorded a degenerate metric.
 */
export function baselineResidualSd(metrics: unknown): number | null {
  const sd =
    readMetric(metrics, RESIDUAL_SD_METRIC_KEY) ??
    readMetric(metrics, 'residual_sd') ??
    readMetric(metrics, 'rmse');
  return sd !== null && sd > 0 ? sd : null;
}

/**
 * True when a metrics blob carries a first-class reference SD, rather than
 * leaning on the `rmse` fallback above.
 *
 * Exists so the backfill can find the blobs that still need one WITHOUT
 * re-deriving the precedence rule — and so a reader can be told which of the
 * two numbers the verdict on their screen was computed from, rather than
 * guessing.
 */
export function hasReferenceResidualSd(metrics: unknown): boolean {
  return (
    (readMetric(metrics, RESIDUAL_SD_METRIC_KEY) ??
      readMetric(metrics, 'residual_sd')) !== null
  );
}
