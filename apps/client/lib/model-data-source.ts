import type { ScheduleSourceRef } from '@/services/inference-window'

/**
 * MODEL-SERVE-013-T04. Which of the five data-source states the Edit
 * dialog is in, decided ONCE here rather than as nested ternaries in the
 * component.
 *
 * - `no-schedule`    — never deployed. `InferenceSchedule.sourceId` is
 *                      required on the row, so "no row" IS "never bound";
 *                      there is nothing to relink and the write path is a
 *                      deliberate no-op.
 * - `missing-source` — the bound id no longer has a `DataSource` row. The
 *                      one state where relinking is the REPAIR, so the
 *                      picker stays open even though the current value is
 *                      unreadable.
 * - `no-candidates`  — bound, but nothing is in production, so the pinned
 *                      version that names the legal choices does not
 *                      exist. Read-only: offering a choice the server
 *                      would refuse is worse than offering none.
 * - `single-source`  — the dataset names exactly one source. Shown, not
 *                      offered.
 * - `selectable`     — two or more choices; the only state with a live
 *                      picker.
 */
export type RelinkState =
  | 'no-schedule'
  | 'missing-source'
  | 'no-candidates'
  | 'single-source'
  | 'selectable'

export interface RelinkView {
  state: RelinkState
  /** The single flag the dialog gates its picker on. */
  canRelink: boolean
  /** The muted line under the label. Never empty: every state says why it
   *  is the state it is, or the picker's absence reads as a bug. */
  note: string
}

export function describeRelink(input: {
  currentSource: ScheduleSourceRef | null
  sourceCandidates: ScheduleSourceRef[]
}): RelinkView {
  const { currentSource, sourceCandidates } = input

  if (!currentSource) {
    return {
      state: 'no-schedule',
      canRelink: false,
      note: 'Not deployed yet — a data source is bound when you start this model.',
    }
  }
  if (currentSource.status === 'missing') {
    return {
      state: 'missing-source',
      canRelink: sourceCandidates.length > 0,
      note: 'This source no longer exists. Pick another to repair the binding.',
    }
  }
  if (sourceCandidates.length === 0) {
    return {
      state: 'no-candidates',
      canRelink: false,
      note: 'No production version — the list of allowed sources is unavailable.',
    }
  }
  if (sourceCandidates.length === 1) {
    return {
      state: 'single-source',
      canRelink: false,
      note: "This model's dataset has only one source.",
    }
  }
  return {
    state: 'selectable',
    canRelink: true,
    note: 'Where live readings are fetched from.',
  }
}

/** The name to print for a source, falling back to the raw id for a row
 *  that no longer resolves — never an empty label. */
export function sourceLabel(source: ScheduleSourceRef | null): string {
  if (!source) return '—'
  return source.name ?? `Unknown source (${source.id})`
}
