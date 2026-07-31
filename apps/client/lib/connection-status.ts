/**
 * Pure mapping for the wizard's Verify-Connection panel (P8 / Step 2).
 *
 * The backend `test-connection` (F6) performs ONE check that reaches PI Web API
 * and resolves the PI **data** server, returning a single `{ ok, message }`. It
 * does NOT test the AF/asset server, so that component is always reported
 * `unverified` rather than a fabricated status (mirrors P1's no-fabrication
 * rule). No React, no IO — just the state→component-status derivation so it can
 * be unit-tested without a live PI server.
 */

/** Lifecycle of a single source's connection test. */
export type VerifyState = 'idle' | 'testing' | 'ok' | 'error'

/** Status of one panel row. `unverified` = this test never checks it. */
export type ComponentStatus = 'idle' | 'pending' | 'ok' | 'error' | 'unverified'

export interface ConnectionComponents {
  /** PI Web API reachable + authenticated. */
  connection: ComponentStatus
  /** PI data server resolved by name. */
  piServer: ComponentStatus
  /** AF/asset server — not covered by this test. */
  assetServer: ComponentStatus
}

/**
 * Derive the three panel rows from a source's verify state. Connection and PI
 * data server share the single test result (the one call validates both), so
 * they move together; the message distinguishes the failure mode. The asset
 * server is always `unverified` — the backend never tests it.
 */
export function deriveConnectionComponents(
  state: VerifyState,
): ConnectionComponents {
  const shared: ComponentStatus =
    state === 'testing'
      ? 'pending'
      : state === 'ok'
        ? 'ok'
        : state === 'error'
          ? 'error'
          : 'idle'
  return {
    connection: shared,
    piServer: shared,
    assetServer: 'unverified',
  }
}
