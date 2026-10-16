/**
 * Plant wall-clock -> UTC, the backend twin of python's
 * `frame_service.wall_clock_to_utc`.
 *
 * Every frame the python service builds holds NAIVE Bangkok-local wall-clock
 * timestamps (`2026-10-16 12:56:00`, no zone). Reading such a string as UTC —
 * the `${value}Z` shortcut — stamps Bangkok digits as UTC and puts the instant
 * 7 hours in the future: Run Predict scores were stored that way and then fell
 * outside every "up to now" range query, so the Actual vs Predict chart never
 * drew them (2026-10-16).
 *
 * A value that already carries a zone (`Z` or `±hh:mm`) is a real instant and
 * passes through unchanged. Bangkok has no DST, so the fixed +07:00 offset is
 * exact for every date.
 */

const PLANT_UTC_OFFSET = '+07:00';
const HAS_ZONE = /([zZ]|[+-]\d{2}:?\d{2})$/;

/** The instant `value` names, or null when it does not parse. */
export function wallClockToUtc(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.replace(' ', 'T');
  const d = new Date(HAS_ZONE.test(iso) ? iso : `${iso}${PLANT_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
