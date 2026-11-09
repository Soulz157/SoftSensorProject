/**
 * MODEL-SERVE-032. Pure rules for a PI write-back batch: no I/O, no DI.
 * The service fetches and writes; this decides what the numbers mean.
 */

export const MAX_WRITE_POINTS = 2000;

/** A recorded value and a requested timestamp are "the same event" when PI's
 *  stored time is within this of what we asked for (PI keeps sub-second time
 *  at its own resolution, so an exact-equality match would miss real hits). */
export const MATCH_TOLERANCE_MS = 1000;

/** How far past "now" a point may be. A prediction for the future is not a
 *  historian record; a few minutes absorbs clock skew between hosts. */
export const FUTURE_SLACK_MS = 5 * 60_000;

export type WritePointInput = { timestamp: string; value: number };

export type NormalizedPoint = { at: number; iso: string; value: number };

export type RecordedEvent = {
  /** epoch ms */
  at: number;
  /** null = PI holds a non-numeric payload (digital / system state) */
  value: number | null;
};

/**
 * Sort by time and reject what would make a batch ambiguous or unsafe:
 * duplicates (after rounding to ms), non-finite values, future points.
 * Returns the first problem as a sentence, never throws.
 */
export function normalizePoints(
  points: readonly WritePointInput[],
  now: number,
): { points: NormalizedPoint[]; error: string | null } {
  const out: NormalizedPoint[] = [];
  const seen = new Set<number>();
  for (const p of points) {
    const at = Date.parse(p.timestamp);
    if (!Number.isFinite(at)) {
      return { points: [], error: `Unreadable timestamp "${p.timestamp}".` };
    }
    if (!Number.isFinite(p.value)) {
      return {
        points: [],
        error: `Point at ${p.timestamp} has a non-finite value.`,
      };
    }
    if (seen.has(at)) {
      return {
        points: [],
        error: `Two points share the timestamp ${new Date(at).toISOString()}.`,
      };
    }
    if (at > now + FUTURE_SLACK_MS) {
      return {
        points: [],
        error: `Point at ${new Date(at).toISOString()} is in the future; only past or current values are written.`,
      };
    }
    seen.add(at);
    out.push({ at, iso: new Date(at).toISOString(), value: p.value });
  }
  out.sort((a, b) => a.at - b.at);
  return { points: out, error: null };
}

/**
 * For each target time, the NEAREST recorded event within `tolMs`, or null.
 * `events` need not be sorted. Nearest, not first: with two events inside the
 * tolerance the closer one is the one a Replace at that time would hit.
 */
export function matchNearest(
  targets: readonly number[],
  events: readonly RecordedEvent[],
  tolMs: number = MATCH_TOLERANCE_MS,
): Array<RecordedEvent | null> {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  return targets.map((t) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].at < t) lo = mid + 1;
      else hi = mid;
    }
    let best: RecordedEvent | null = null;
    for (const cand of [sorted[lo - 1], sorted[lo]]) {
      if (!cand) continue;
      const d = Math.abs(cand.at - t);
      if (d <= tolMs && (best === null || d < Math.abs(best.at - t))) {
        best = cand;
      }
    }
    return best;
  });
}

/** PI stores Float32 for most tags, so a round trip loses precision. Equal
 *  means equal to ~1e-6 relative (float32 is ~6e-8): tighter would call every
 *  Float32 write a failure, looser could hide a genuinely different value. */
export function sameValue(sent: number, stored: number): boolean {
  return Math.abs(sent - stored) <= 1e-6 * Math.max(1, Math.abs(sent));
}

export type BatchStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED';

export function deriveStatus(ok: number, total: number): BatchStatus {
  if (total > 0 && ok === total) return 'SUCCEEDED';
  return ok === 0 ? 'FAILED' : 'PARTIAL';
}

/** What a failed item says, from the three things that can go wrong. */
export function itemOutcome(input: {
  writerOk: boolean;
  writerError: string | null;
  sent: number;
  stored: number | null;
}): { ok: boolean; error: string | null } {
  if (!input.writerOk) {
    return { ok: false, error: input.writerError ?? 'PI rejected the value.' };
  }
  if (input.stored === null) {
    return {
      ok: false,
      error:
        'PI accepted the write but no value is stored at this time (compression or a rejected timestamp).',
    };
  }
  if (!sameValue(input.sent, input.stored)) {
    return {
      ok: false,
      error: `PI stored ${input.stored} instead of ${input.sent}.`,
    };
  }
  return { ok: true, error: null };
}

// ── rollback ────────────────────────────────────────────────────────────────

/** What a batch recorded for one point (a `PiWriteValue` row, as numbers). */
export type RecordedBatchPoint = {
  at: number;
  beforeExisted: boolean;
  beforeValue: number | null;
  /** What PI held right after the original write; null = nothing there. */
  afterValue: number | null;
};

/** What PI holds NOW at a point, as `matchNearest` found it. */
export type CurrentState =
  | { kind: 'none' }
  | { kind: 'value'; value: number }
  | { kind: 'system' }; // a non-numeric payload (digital / system state)

export function currentState(event: RecordedEvent | null): CurrentState {
  if (event === null) return { kind: 'none' };
  return event.value === null
    ? { kind: 'system' }
    : { kind: 'value', value: event.value };
}

export type RollbackAction =
  /** PI already holds the original state: nothing to send. */
  | 'SKIP'
  /** Put the original value back (also covers a value PI altered since). */
  | 'REPLACE'
  /** The point did not exist before the batch: delete it. */
  | 'REMOVE'
  /** PI holds a non-numeric system state here. Never overwritten or removed. */
  | 'BLOCKED';

export type RollbackPlanItem = {
  at: number;
  action: RollbackAction;
  /** Value to write for REPLACE; null otherwise. */
  restoreTo: number | null;
  /** True when PI no longer holds what the original write left there. */
  drifted: boolean;
  expected: number | null;
  actual: CurrentState;
};

function sameNullable(a: number | null, b: CurrentState): boolean {
  if (b.kind === 'system') return false;
  if (a === null) return b.kind === 'none';
  return b.kind === 'value' && sameValue(a, b.value);
}

/**
 * Per point: where PI stands now versus where the original write left it
 * (drift), and what returns it to where it stood BEFORE the write.
 *
 * Drift is not an action. A drifted point still gets an action (restoring the
 * original is what rollback means) but the service refuses to proceed unless
 * the caller forces: someone else changed the value since, and the rollback
 * would overwrite their work.
 */
export function planRollback(
  points: readonly RecordedBatchPoint[],
  current: readonly CurrentState[],
): RollbackPlanItem[] {
  return points.map((p, i) => {
    const actual = current[i] ?? { kind: 'none' as const };
    const target = p.beforeExisted ? p.beforeValue : null;
    // Not drift: PI holds what we left there, OR it already holds the original
    // state (an earlier partial rollback restored this point). Without the
    // second clause a retry would call its own earlier work "someone else's".
    const drifted =
      !sameNullable(p.afterValue, actual) && !sameNullable(target, actual);

    let action: RollbackAction;
    if (actual.kind === 'system') action = 'BLOCKED';
    else if (sameNullable(target, actual)) action = 'SKIP';
    else action = target === null ? 'REMOVE' : 'REPLACE';

    return {
      at: p.at,
      action,
      restoreTo: action === 'REPLACE' ? target : null,
      drifted,
      expected: p.afterValue,
      actual,
    };
  });
}

/** After a rollback: is the point back where it stood before the batch? */
export function restoredOutcome(
  point: Pick<RecordedBatchPoint, 'beforeExisted' | 'beforeValue'>,
  action: RollbackAction,
  writerOk: boolean,
  writerError: string | null,
  now: CurrentState,
): { ok: boolean; error: string | null } {
  if (action === 'BLOCKED') {
    return {
      ok: false,
      error:
        'PI holds a non-numeric system state here; rollback does not overwrite it.',
    };
  }
  if (!writerOk) {
    return { ok: false, error: writerError ?? 'PI rejected the restore.' };
  }
  const target = point.beforeExisted ? point.beforeValue : null;
  if (sameNullable(target, now)) return { ok: true, error: null };
  return {
    ok: false,
    error:
      target === null
        ? 'The point is still present in PI after the remove.'
        : `PI holds ${now.kind === 'value' ? now.value : 'nothing'} instead of the original ${target}.`,
  };
}
