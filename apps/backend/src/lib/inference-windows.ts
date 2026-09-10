/**
 * MODEL-SERVE-006-T01/T02/T11. THE unique constraint the whole feature
 * rests on is `(modelVersionId, windowStart)` — which means `windowStart`
 * must be computed EXACTLY the same way by every caller that can create a
 * window row, or two callers computing slightly different boundaries for
 * "the same" window mint two rows instead of one, and `skipDuplicates`
 * cannot catch it because the timestamps genuinely differ.
 *
 * Two callers exist: the scheduler tick (`InferenceWindowSchedulerService`)
 * and the backfill route (`POST /inference/backfill`). Both call this pure
 * function — no Prisma, no I/O, unit-testable directly — instead of each
 * computing alignment inline.
 *
 * Alignment is on the UTC epoch, not local wall clock: `Date.now()`
 * arithmetic in this file never touches a timezone. Bangkok-local
 * conversion happens exactly once, on the python side, when a window's
 * boundaries are compared against a Bangkok-naive fetched frame (see
 * `frame_service.utc_to_wall_clock`'s own doc comment for why that
 * conversion belongs there and nowhere upstream of it).
 */

const MS_PER_MINUTE = 60_000;

/**
 * Every aligned `windowStart` in the half-open range `[from, to)`, at
 * `cadenceMinutes` spacing, epoch-aligned (windowStart is always a multiple
 * of `cadenceMinutes * 60_000` ms since the Unix epoch — never derived from
 * `from` itself, which would let an unaligned `from` on a backfill request
 * mint boundaries the live tick would never produce for the same range).
 *
 * `to` is exclusive: a window whose start equals `to` is not included,
 * matching every window's own `[windowStart, windowEnd)` convention.
 */
export function windowStartsBetween(
  from: Date,
  to: Date,
  cadenceMinutes: number,
): Date[] {
  if (cadenceMinutes <= 0) {
    throw new Error(`cadenceMinutes must be positive, got ${cadenceMinutes}`);
  }
  const cadenceMs = cadenceMinutes * MS_PER_MINUTE;
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (toMs <= fromMs) return [];

  // Round UP to the next aligned boundary at or after `from` — a window
  // whose start is strictly before `from` is not "between from and to",
  // even if its END would fall inside the range.
  const firstAligned = Math.ceil(fromMs / cadenceMs) * cadenceMs;

  const starts: Date[] = [];
  for (let ms = firstAligned; ms < toMs; ms += cadenceMs) {
    starts.push(new Date(ms));
  }
  return starts;
}

/** The paired `windowEnd` for a given `windowStart` — always exactly one
 *  cadence later. A separate function rather than inlining `+cadenceMs`
 *  everywhere: the ONE place this arithmetic lives is the one place a
 *  future change to what "one window" spans has to touch. */
export function windowEndFor(windowStart: Date, cadenceMinutes: number): Date {
  return new Date(windowStart.getTime() + cadenceMinutes * MS_PER_MINUTE);
}

/**
 * MODEL-SERVE-006-T06. `{dt, hour}` in UTC — the two values NestJS passes
 * to python's inference-window materialize/presign-upload calls (see
 * `artifact-keys.ts`'s `INFERENCE_ROOT` doc comment). Deliberately UTC, not
 * Bangkok-local: this is a STORAGE PARTITION boundary keyed on the window's
 * own `windowStart` (already a real UTC instant), not a value compared
 * against the Bangkok-naive frame python fetches — that comparison happens
 * only inside `materialize_window`, using `utc_to_wall_clock`, never here.
 */
export function formatDtHour(windowStart: Date): { dt: string; hour: string } {
  const iso = windowStart.toISOString(); // e.g. "2026-09-10T08:00:00.000Z"
  return { dt: iso.slice(0, 10), hour: iso.slice(11, 13) };
}
