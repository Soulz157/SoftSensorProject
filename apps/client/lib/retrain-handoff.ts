/**
 * MODEL-SERVE-017. The one fact that has to survive the retrain dialog
 * sending an operator into the Data Studio wizard: that they were in the
 * middle of setting up a retrain, and for which model.
 *
 * The handoff is a full page navigation, so the dialog unmounts and its
 * state dies. Without this, saving the new dataset lands the operator in
 * Data Studio with no route back — they must find the model again, reopen
 * the dialog, re-pick the strategy, and hunt for the dataset they just made.
 *
 * `sessionStorage`, deliberately:
 *  - It is a UI convenience, never a source of truth. The retrain payload is
 *    still built from what the dialog reads back off the server.
 *  - Session scope is the honest lifetime. An intent from a tab the operator
 *    closed yesterday should not reopen a dialog today, which is exactly
 *    what `localStorage` would do.
 *
 * Every access is wrapped: storage throws in private-browsing modes and is
 * absent during SSR. A failure to remember degrades to "the dialog opens
 * empty", which is the behaviour before this existed — never a crash.
 */

const KEY = 'softsensor.retrain-handoff'

export interface RetrainHandoff {
  modelId: string
  /** The strategy chosen before leaving, restored on return. */
  strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
  /** Where to send the operator once the new dataset is saved. */
  returnTo: string
}

function isHandoff(value: unknown): value is RetrainHandoff {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.modelId === 'string' &&
    v.modelId.length > 0 &&
    (v.strategy === 'AUGMENT_DATA' || v.strategy === 'NEW_DATA_ONLY') &&
    typeof v.returnTo === 'string' &&
    // Same-origin path only. This value ends up in `router.push`, and a
    // stored absolute URL would turn a stale storage entry into an
    // open-redirect at save time.
    v.returnTo.startsWith('/')
  )
}

export function rememberRetrainHandoff(handoff: RetrainHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff))
  } catch {
    // Storage unavailable — the return trip is lost, nothing else is.
  }
}

/** Reads without clearing — for deciding where a save should navigate. */
export function peekRetrainHandoff(): RetrainHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    // A shape that no longer matches (an older build's record, a hand-edited
    // value) is discarded rather than trusted into a route.
    return isHandoff(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Reads and clears in one step. The model page calls this: an intent must
 * reopen the dialog exactly once, not on every later visit to that model.
 */
export function consumeRetrainHandoff(): RetrainHandoff | null {
  const handoff = peekRetrainHandoff()
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Non-fatal: the caller already has the value.
  }
  return handoff
}

export function clearRetrainHandoff(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Non-fatal.
  }
}

/**
 * MODEL-SERVE-015-T06. The suffix the backend stamps onto the
 * `semanticVersion` of a DatasetVersion it mints from an augmented retrain.
 *
 * MIRRORED from `AUGMENTED_VERSION_SUFFIX` in the backend's
 * `model-retrain-augment.authorized.service.ts`. It is duplicated rather
 * than imported because `@softsensor/common` pulls in NestJS and Fastify and
 * is not safe in the Next.js bundle; keep the two in sync.
 */
export const AUGMENTED_VERSION_SUFFIX = '+augmented'

/**
 * Whether a DatasetVersion is itself the output of an augmented retrain.
 *
 * `semanticVersion` is the only signal available here: the versions list
 * endpoint does not return `lineage`. Used to keep an augmented version out
 * of the "new data" picker, so each retrain's output cannot silently become
 * the next retrain's input and compound the augmentation.
 */
export function isAugmentedVersion(
  version: { semanticVersion?: string | null } | null | undefined,
): boolean {
  return version?.semanticVersion?.endsWith(AUGMENTED_VERSION_SUFFIX) ?? false
}

/**
 * The URL the wizard sends the operator back to after saving. The new
 * dataset and version travel as query params rather than through storage:
 * they are produced by the save call itself, and a param is visible,
 * shareable, and cannot go stale in a second tab.
 */
export function retrainReturnUrl(
  handoff: RetrainHandoff,
  datasetId: string,
  versionId: string | null,
): string {
  const params = new URLSearchParams({
    retrainStrategy: handoff.strategy,
    retrainDatasetId: datasetId,
  })
  if (versionId) params.set('retrainVersionId', versionId)
  return `${handoff.returnTo}?${params.toString()}`
}
