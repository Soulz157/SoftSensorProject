import { Logger } from '@nestjs/common';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { readFeatureSpec } from '@/lib/python-preprocess-client';
import { PythonColumnStatsSchema } from '@/api/v1/dataset-version/authorized/dto/dataset-version.authorized.dto';
import type { ColumnBaselineMap } from '@/lib/prediction-drift';
import type { PsiReferenceMap } from '@/lib/prediction-psi';

const log = new Logger('ArtifactBaseline');

/**
 * MODEL-SERVE-001-T17. Extracted verbatim (behaviour-preserving) from
 * `PredictionLogAuthorizedService`'s own private `resolveBaseline`/
 * `resolvePsiReference` — a PRODUCTION version's training-artifact baseline
 * is the same fact regardless of which LIVE plane (`/predict`'s
 * `PredictionLog`, or scheduled inference's `InferenceWindow`) is being
 * compared against it. Moved here so the window-plane monitoring service
 * (`inference-window/authorized/inference-window-monitoring.authorized.
 * service.ts`) reads the identical sidecar the same way, rather than a
 * second copy of this I/O that could silently drift from the first —
 * `PredictionLogModule` importing `InferenceWindowModule` (not the reverse)
 * rules out `InferenceWindowAuthorizedService` depending back on
 * `PredictionLogAuthorizedService` to reuse its private methods instead.
 *
 * No caller passes a `user` here — access to the owning Model was already
 * checked once, on the Model, by whichever plane's public service method
 * is calling in. Same reasoning `getPsiService`'s own original doc comment
 * gave for calling python directly rather than through a request-scoped
 * service method.
 */

/**
 * MODEL-SERVE-001-T30 (list-payload frozen detection). `goldObjectKey` names
 * an IMMUTABLE artifact — a production version's GOLD parquet never changes
 * once trained, and re-promoting a model onto a new artifact produces a NEW
 * key rather than mutating the old one. So a successful read here can never
 * go stale, which is what makes caching by this key safe rather than merely
 * convenient.
 *
 * WHY THIS EXISTS NOW, NOT WHEN THE FUNCTION WAS WRITTEN. Every existing
 * caller reads a baseline for ONE model, once, inside a single request —
 * `getDriftService`/`getPsiService`/`getHealthStatus`. `deriveDeployStatuses`
 * (deploy-status.ts) is the first caller to run this on the LIST path, which
 * means the SAME set of models' SAME keys get re-fetched on every Alerts/
 * Overview/sidebar poll. Uncached, that is an HTTP round trip to apps/python
 * per enabled model, repeated on a timer, for data that cannot have changed.
 *
 * CACHES THE PROMISE, NOT ONLY THE RESOLVED VALUE — collapses concurrent
 * callers asking for the same key (the batched derivation's own
 * `Promise.all` over enabled models, plus overlapping requests) into one
 * in-flight sidecar call rather than one each.
 *
 * A FAILURE IS NEVER CACHED. A missing/unreachable sidecar returns `{}` (see
 * below) so the caller degrades gracefully — but `{}` is a fact about THIS
 * attempt, not about the artifact, and remembering it would turn a transient
 * outage into a permanent one until process restart. Only a resolved,
 * successfully-parsed result is stored.
 *
 * UNBOUNDED BY DESIGN, NOT BY OVERSIGHT: bounded by the number of DISTINCT
 * production GOLD artifacts this process ever serves, not by request volume
 * — a small, slowly-growing set in practice. Add eviction if that stops
 * being true; it is not a problem this task has evidence of.
 */
const columnBaselineCache = new Map<string, Promise<ColumnBaselineMap>>();

/** Test-only. Every existing spec that mocks the sidecar call reuses one
 *  literal `goldObjectKey` across several `it()` blocks with DIFFERENT mock
 *  configurations for the same key — exactly the case a persistent cache
 *  would poison (a later test silently seeing an earlier test's cached
 *  result instead of its own mock). Call this from `afterEach`/`beforeEach`
 *  in any spec that configures `postToPython` for column-stats. */
export function resetColumnBaselineCacheForTests(): void {
  columnBaselineCache.clear();
}

/**
 * Reads `column_stats.json` for a PRODUCTION version's own training
 * artifact — the SAME sidecar `getArtifactColumnStatsService` serves.
 *
 * A missing sidecar (a legacy artifact predating column_stats.json) is NOT
 * an error — every column simply reports UNKNOWN with a named reason
 * (`computeDrift`'s own "no training baseline" branch), the same honest-
 * empty-state discipline `getArtifactHoldoutService` uses for a dataset
 * with no holdout.
 */
export async function resolveColumnBaseline(
  goldObjectKey: string,
): Promise<ColumnBaselineMap> {
  const cached = columnBaselineCache.get(goldObjectKey);
  if (cached) return cached;

  const attempt = (async () => {
    const result = PythonColumnStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/column-stats',
        { source_key: goldObjectKey },
        PYTHON_TIMEOUT.metadata,
      ),
    );
    const baseline: ColumnBaselineMap = {};
    for (const [tag, stats] of Object.entries(result.stats)) {
      baseline[tag] = {
        mean: stats.mean ?? null,
        std: stats.std ?? null,
        percentiles: stats.percentiles
          ? { p1: stats.percentiles.p1, p99: stats.percentiles.p99 }
          : null,
      };
    }
    return baseline;
  })();

  // Cached BEFORE it settles, so concurrent callers share the one in-flight
  // attempt — then evicted on failure so the next call retries fresh rather
  // than replaying a rejection nothing here would otherwise clear.
  columnBaselineCache.set(goldObjectKey, attempt);
  try {
    return await attempt;
  } catch (err) {
    columnBaselineCache.delete(goldObjectKey);
    log.warn(
      `column_stats unavailable for ${goldObjectKey}; drift will report every column UNKNOWN: ${(err as Error).message}`,
    );
    return {};
  }
}

/**
 * Reads `feature_spec.json` for a PRODUCTION version's own training
 * artifact — via `readFeatureSpec`, the SAME sidecar read the serving
 * descriptor already uses (`model-serving.authorized.service.ts`'s
 * `buildDescriptor`) — and un-flattens its four parallel per-tag maps
 * (`psiRefEdges`/`psiBinCount`/`psiBinMode`/`psiRefCounts`) back into one
 * `PsiReference` object per tag, the shape `computePsi` consumes.
 *
 * A tag missing ANY of the four (a malformed or partially-written spec) is
 * skipped entirely, never assembled from whichever fields happen to be
 * present — an incomplete reference is not a usable one, and `computePsi`
 * already reports a clean UNKNOWN for a tag with no reference at all, so
 * silently dropping it here is the same honest "no reference" outcome, not
 * a lossy one.
 *
 * A missing sidecar (legacy artifact, or one that predates T13) is NOT an
 * error — same discipline `resolveColumnBaseline` uses for a missing
 * column_stats.json: every column reports UNKNOWN with a named reason.
 */
export async function resolvePsiReference(
  goldObjectKey: string,
): Promise<PsiReferenceMap> {
  try {
    const { spec } = await readFeatureSpec(goldObjectKey);
    const edges = spec.psiRefEdges ?? {};
    const binCounts = spec.psiBinCount ?? {};
    const binModes = spec.psiBinMode ?? {};
    const refCounts = spec.psiRefCounts ?? {};

    const reference: PsiReferenceMap = {};
    for (const tag of Object.keys(edges)) {
      const binMode = binModes[tag];
      const binCount = binCounts[tag];
      const tagRefCounts = refCounts[tag];
      if (binMode === undefined || binCount === undefined || !tagRefCounts) {
        continue;
      }
      reference[tag] = {
        binMode,
        binCount,
        edges: edges[tag],
        refCounts: tagRefCounts,
      };
    }
    return reference;
  } catch (err) {
    log.warn(
      `feature_spec unavailable for ${goldObjectKey}; PSI will report every column UNKNOWN: ${(err as Error).message}`,
    );
    return {};
  }
}
