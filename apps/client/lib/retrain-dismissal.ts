/**
 * MODEL-SERVE-014. Which retrain result THIS viewer has closed.
 *
 * Needed because the retrain section is reconstructed from the server on
 * every mount (`GET .../retrain/current` returns the most recent job, live
 * or finished, so a completed result stays visible). A plain `useState`
 * dismissal — the shape `draft-resume-section.tsx` uses for its banner —
 * would therefore pop the section back open on every refresh.
 *
 * Scoped to a JOB id, not a model: closing v2's result must not suppress
 * the next retrain's, which is a different job and genuinely new
 * information.
 *
 * `localStorage` is the right home precisely because this is a per-viewer
 * convenience and nothing else: it is not a fact about the model, no one
 * else needs to see it, and losing it costs the viewer one click. Every
 * access is guarded — a private window, blocked site data, or SSR all make
 * these throw or return null, and the section must simply render as
 * not-dismissed in that case.
 */

const KEY_PREFIX = 'retrain-dismissed:'

export function readDismissedJobId(modelId: string): string | null {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${modelId}`)
  } catch {
    return null
  }
}

export function writeDismissedJobId(modelId: string, jobId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${modelId}`, jobId)
  } catch {
    // Non-fatal: the section stays closed for this session only.
  }
}

export function clearDismissedJobId(modelId: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${modelId}`)
  } catch {
    // Non-fatal.
  }
}
