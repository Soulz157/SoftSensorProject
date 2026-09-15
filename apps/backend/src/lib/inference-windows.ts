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

const DURATION_UNIT_MINUTES: Record<string, number> = {
  s: 1 / 60,
  m: 1,
  h: 60,
  d: 1440,
};

/**
 * Parse a PI summary-duration string ("30s", "1m", "10m", "1h") into
 * MINUTES. Mirrors `apps/client/lib/dataset-fetch.ts`'s own `parseDurationMs`
 * one unit up (minutes here, milliseconds there) — duplicated rather than
 * shared: the two live in separate apps (client/backend) with no existing
 * shared TS package sized for one small format parser, and this codebase's
 * own convention (packages/py-scaling) reserves a shared package for logic
 * that must never drift between processes that both COMPUTE with it (train
 * vs. serve). This is read-only string parsing on one side only; keep the
 * accepted format (`\d+[smhd]`) in sync with the client's copy if it ever
 * changes.
 *
 * Returns null for anything that does not match — never a wrong guess, per
 * the client copy's own contract: "so callers can fall back to a known-good
 * value rather than a wrong one."
 */
function parseIntervalMinutes(duration: string): number | null {
  const match = /^(\d+)\s*([smhd])$/.exec(duration.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unitMinutes = DURATION_UNIT_MINUTES[match[2]];
  if (!Number.isFinite(value) || value <= 0 || unitMinutes === undefined) {
    return null;
  }
  return value * unitMinutes;
}

/**
 * MODEL-SERVE-001-T14. The per-schedule floor for "too few usable rows ->
 * SKIPPED" — `env.INFERENCE_MIN_ROWS`'s own derivation ("half an hourly
 * window at the observed dataset's 1-minute interval, 60 rows/hour") bakes
 * in ONE sampling interval as a GLOBAL constant, so any schedule fetching
 * at a different interval than 1 minute has always been evaluated against
 * the wrong expectation: a 5-minute-interval schedule has 12 rows in a
 * complete, healthy hourly window and would read SKIPPED against a 30-row
 * floor forever, for a plant working exactly as intended — the "guess
 * wearing a formula" shape MODEL-FLOW-020's own finding 3 names, one level
 * removed (the FORMULA is fine; it was evaluated against the wrong,
 * globally-assumed interval).
 *
 * Returns null — NEVER a wrong guess — when `intervalTime` is absent (a
 * non-PI source: `SQLConfig`/`InfluxConfig`/etc. carry no interval concept
 * at all — see `store/model-pipeline.ts`'s own `DataSourceConfig` union,
 * verified: only `PIConfig` has an `intervalTime` field) or unparseable
 * (free-text input with no client-side format validation). The caller
 * falls back to `env.INFERENCE_MIN_ROWS` in that case — the SAME safe
 * default every schedule already uses today, never a fabricated
 * per-schedule number derived from a guess at what the interval might be.
 *
 * Clamped to a minimum of 1: a floor of 0 would make SKIPPED unreachable
 * for a degenerate interval (interval >= window length), silently treating
 * a genuinely EMPTY window as merely sparse rather than as the real
 * problem it is.
 */
export function deriveMinRows(
  cadenceMinutes: number,
  intervalTime: string | undefined,
): number | null {
  if (!intervalTime) return null;
  const intervalMinutes = parseIntervalMinutes(intervalTime);
  if (intervalMinutes === null) return null;
  const expectedRows = cadenceMinutes / intervalMinutes;
  return Math.max(1, Math.floor(expectedRows / 2));
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
