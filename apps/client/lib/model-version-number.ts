/**
 * MODEL-SERVE-001-T08. A version number a caller can only get by RECEIVING
 * one from the server (a saved model's own create response, or a fetched
 * version row) — never by writing a literal, which is exactly how
 * `phase-6-deploy.tsx` used to call `promote(modelId, 1)`: correct today
 * only because Save & Deploy is create-mode-only, a UI branch rather than a
 * fact `MODEL-SERVE-004-T04`'s `max(version)+1` retrain path does not share.
 *
 * Same brand-a-plain-value shape as `lib/preprocessing.ts`'s
 * `BoundedSample`/`brandBoundedSample` — a private, non-exported symbol so a
 * bare `number` (including a literal like `1`) cannot be assigned where a
 * `ModelVersionNumber` is expected without going through
 * `brandModelVersionNumber()`.
 *
 * Honest about what this buys: `brandModelVersionNumber(1)` still compiles —
 * this is not "unwriteable". What it buys is that a BARE LITERAL fails
 * `tsc`, and minting is confined to the two boundary modules that parse a
 * server response (`services/model-monitoring.ts`'s input-schema read,
 * `services/model-draft.ts`'s save response) rather than being reachable
 * from any call site that merely knows a small integer.
 */
declare const modelVersionNumberBrand: unique symbol
export type ModelVersionNumber = number & {
  readonly [modelVersionNumberBrand]: true
}

/** The ONE legitimate way to mint one — from a version row the server
 *  actually returned. */
export function brandModelVersionNumber(version: number): ModelVersionNumber {
  return version as ModelVersionNumber
}
