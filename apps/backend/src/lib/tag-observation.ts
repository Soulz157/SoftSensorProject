/**
 * MODEL-SERVE-009-T02. What one fetch's per-tag reading does to the stored
 * current state — pure, so the rule that decides "changed" is testable
 * without a database or a fetch.
 *
 * THE WHOLE FEATURE IS THE DISTINCTION BETWEEN TWO TIMESTAMPS.
 * `lastSeenAt` advances on every fetch that returned the tag at all, even
 * when the value is identical and even when the cell was Bad — it is about
 * ARRIVAL. `lastChangedAt` advances only when the value actually differs
 * from the one before it — it is about MOVEMENT. Collapsing them gives back
 * exactly the pooled-range inference MODEL-SERVE-001-T29 already has, which
 * quantises to whole windows and cannot see a flat run shorter than three
 * of them.
 */

/** `{tag}__status` from the fetch path: 0 Good, 1 Bad, 2 Questionable. */
export const TAG_STATUS_GOOD = 0;

export type FetchOutcome = 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface TagReading {
  lastValue: number;
  lastStatus: number;
  observedAt: string;
}

/** The stored row, as far as this module needs to read it. */
export interface StoredTagObservation {
  lastValue: number | null;
  lastChangedAt: Date | null;
  /** MODEL-SERVE-009-T02. Needed to reject an OUT-OF-ORDER reading — see
   *  `nextTagObservation`'s staleness guard. */
  lastSeenAt: Date | null;
}

export interface TagObservationUpdate {
  lastValue: number;
  lastStatus: number;
  lastSeenAt: Date;
  lastChangedAt: Date;
  lastFetchOutcome: FetchOutcome;
}

/**
 * Decide the next stored state for ONE tag from one reading.
 *
 * A BAD CELL ADVANCES `lastSeenAt` BUT NEVER `lastChangedAt`, and this is
 * the load-bearing asymmetry. A Bad cell still carries a number — often a
 * plausible one — and letting it count as movement would mean a broken
 * sensor reads as a healthy one precisely because it is broken. It arrived,
 * so arrival is recorded; it is not a measurement, so movement is not.
 *
 * The comparison is against the STORED value, not against a window
 * aggregate: two fetches that both report 42.0 leave `lastChangedAt` where
 * it was, however many fetches separate them, so the flat duration is exact
 * rather than rounded to the cadence.
 */
export function nextTagObservation(
  reading: TagReading,
  stored: StoredTagObservation | null,
  now: Date,
): TagObservationUpdate | null {
  const observedAt = new Date(reading.observedAt);
  // An unparseable timestamp from the connector must not become an Invalid
  // Date in the database — fall back to the fetch's own clock, which is
  // late but real, rather than storing NaN.
  const seenAt = Number.isNaN(observedAt.getTime()) ? now : observedAt;

  // MODEL-SERVE-009-T02, FOUND LIVE. This row is CURRENT state, so an
  // OLDER reading must never overwrite it. A retry or a backfill replays a
  // past window through the same materialize path (that is the point of
  // MODEL-SERVE-006-T11's one-path rule), and its `observed_at` is behind
  // whatever the newest fetch already wrote. Applying it walked lastSeenAt
  // BACKWARDS and left lastChangedAt AFTER lastSeenAt — a negative flat
  // duration, which `flatMinutes`' clamp would then hide as a confident 0.
  // Measured on the live database: retrying one window inverted 5 rows.
  // Returning null means "this reading tells us nothing NEWER", which is
  // different from a failed fetch and is why the caller skips the write
  // entirely rather than recording an outcome.
  if (stored?.lastSeenAt && seenAt.getTime() <= stored.lastSeenAt.getTime()) {
    return null;
  }

  const usable = reading.lastStatus === TAG_STATUS_GOOD;
  const changed =
    usable && (stored === null || stored.lastValue !== reading.lastValue);

  return {
    lastValue: reading.lastValue,
    lastStatus: reading.lastStatus,
    lastSeenAt: seenAt,
    // First sighting counts as a change: there is no prior value to be the
    // same as, and claiming the tag has been flat since the beginning of
    // time would be a worse answer than "it changed when we first saw it".
    // MODEL-SERVE-009's findings[8] is the matching warning on the other
    // side — the first hour after enabling is a real state and must not
    // read as frozen.
    lastChangedAt:
      changed || stored?.lastChangedAt == null ? seenAt : stored.lastChangedAt,
    lastFetchOutcome: 'SUCCEEDED',
  };
}

/**
 * How long a tag has been flat, in minutes — the number T29's three-window
 * pooled range can only approximate. Null when either timestamp is missing,
 * never 0: "we do not know" and "it changed just now" are different answers
 * and this ledger has refused to pool that kind of pair repeatedly.
 */
export function flatMinutes(row: {
  lastSeenAt: Date | null;
  lastChangedAt: Date | null;
}): number | null {
  if (!row.lastSeenAt || !row.lastChangedAt) return null;
  return Math.max(
    0,
    (row.lastSeenAt.getTime() - row.lastChangedAt.getTime()) / 60_000,
  );
}
