/**
 * MODEL-FLOW-022-T03. Extracted from `algorithm-selector.tsx`, which held
 * `GPR_MAX_TRAIN_ROWS` and its own local `oversizedReason` unexported —
 * MODEL-FLOW-013-T05a's rule about a membership list in the client being a
 * second source of truth applies to an eligibility predicate exactly as it
 * does to a render mode. The per-algorithm hyperparameter block needs the
 * SAME predicate the selector uses, not a copy of it, so both import from here.
 *
 * MODEL-FLOW-019-T30 correction, 2026-09-11: both consumers this comment
 * originally named are gone. `e9fcdf6` deleted `algorithm-selector.tsx` and
 * replaced it with `algorithm-stack.tsx`, which merged the tabbed block into
 * one expandable card per algorithm; `algorithm-param-tabs.tsx` itself was
 * never committed. `algorithm-stack.tsx` is the sole consumer.
 *
 * Pure module (no React) — same discipline `training-config.ts` states for
 * itself.
 */
import type { Algorithm } from '@/store/model-pipeline'

/**
 * MODEL-FLOW-020-T06. MIRRORS `GPR_MAX_TRAIN_ROWS` in
 * `images/trainer/app/models.py` — the measured ceiling above which
 * `build_model` refuses Gaussian Process outright (an n x n kernel matrix,
 * O(n^3) to fit, against that container's memory limit). The number is
 * measured THERE and only echoed here; if it moves, it moves there first.
 * Same mirror discipline `images/trainer/app/MIRRORS.md` records for
 * `MIN_LABELS_PER_FOLD`.
 *
 * KEYED ON ROWS, DELIBERATELY. This is not a capacity bound but a RESOURCE
 * ceiling: bytes of kernel matrix, and bytes scale with rows however few
 * distinct values those rows hold.
 *
 * MODEL-FLOW-022-T01 correction 4: `lstm`/`gru`'s `LSTM_MAX_TRAIN_WINDOWS`
 * ceiling (`images/trainer/app/models.py:115`) has NO client-side mirror —
 * `grp`/`GPR_MAX_TRAIN_ROWS` is the sole client-side eligibility rule.
 */
export const GPR_MAX_TRAIN_ROWS = 10_000

/**
 * Why an algorithm cannot be picked for THIS dataset. `null` when every
 * algorithm is eligible, or when `trainLabelledRows` is unknown (before
 * Apply, and in CV mode, where no single train split exists) — no refusal
 * is offered then, since refusing on a number this function does not have
 * would be a guess wearing a limit. The trainer's own fit-time backstop
 * still fires regardless.
 */
export function ineligibleReason(
  algorithm: Algorithm,
  trainLabelledRows: number | null,
): string | null {
  if (algorithm !== 'grp') return null
  if (trainLabelledRows === null || trainLabelledRows <= GPR_MAX_TRAIN_ROWS) {
    return null
  }
  return (
    `Needs a ${trainLabelledRows.toLocaleString()} x ` +
    `${trainLabelledRows.toLocaleString()} kernel matrix — over the ` +
    `measured ${GPR_MAX_TRAIN_ROWS.toLocaleString()}-row ceiling for ` +
    `the training container. Try Random Forest, LightGBM or XGBoost.`
  )
}
