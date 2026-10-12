/**
 * MODEL-FLOW-032. The one fact that has to survive Create Model Step 1
 * sending the user into the Data Studio wizard to build the dataset they
 * want to train on: what they had already typed into Step 1.
 *
 * Create mode resets the whole wizard on mount (`useModelWizardMode`), and
 * at Step 1 there is no server-side `ModelDraft` yet to resume from — one is
 * only minted once training starts. Without this the return trip would land
 * on an empty form with the new dataset nowhere selected.
 *
 * `sessionStorage`, for the same reasons `retrain-handoff.ts` gives: a UI
 * convenience, never a source of truth, with the tab as its honest lifetime.
 * The new dataset's id does NOT travel here — Save produces it, so it rides
 * back as a query param (`modelCreateReturnUrl`). Every access is wrapped:
 * a failure to remember degrades to "Step 1 comes back empty", never a crash.
 */

const KEY = 'softsensor.model-create-handoff'

/** The query param the wizard reads the freshly saved dataset from. */
export const NEW_DATASET_PARAM = 'newDatasetId'

export interface ModelCreateHandoff {
  name: string
  description: string
  workspaceId: string
  plantId: string
  nodeId: string
}

function isHandoff(value: unknown): value is ModelCreateHandoff {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    typeof v.workspaceId === 'string' &&
    v.workspaceId.length > 0 &&
    typeof v.plantId === 'string' &&
    typeof v.nodeId === 'string'
  )
}

export function rememberModelCreateHandoff(handoff: ModelCreateHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff))
  } catch {
    // Storage unavailable — Step 1 comes back empty, nothing else is lost.
  }
}

/**
 * Reads without clearing. Data Studio's Save calls this to decide where to
 * navigate; the model wizard is the one that consumes it, because it is the
 * one that needs the values.
 */
export function peekModelCreateHandoff(): ModelCreateHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isHandoff(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Reads and clears in one step, so Step 1 is restored exactly once. */
export function consumeModelCreateHandoff(): ModelCreateHandoff | null {
  const handoff = peekModelCreateHandoff()
  clearModelCreateHandoff()
  return handoff
}

export function clearModelCreateHandoff(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Non-fatal.
  }
}

/** Where Data Studio's Save sends the user back to. A fixed same-origin
 * path, so nothing read out of storage ever reaches `router.push`. */
export function modelCreateReturnUrl(datasetId: string): string {
  const params = new URLSearchParams({ [NEW_DATASET_PARAM]: datasetId })
  return `/models/create?${params.toString()}`
}
