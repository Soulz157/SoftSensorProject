/**
 * The retrain dialog's new-data validation window, as the two `yyyy-MM-dd`
 * strings its date inputs hold. Pure — no React, no IO.
 *
 * The bounds come from the chosen version's artifact metadata, whose
 * `startTime`/`endTime` are the real min/max of its timestamp column
 * (`object_store.get_frame_metadata`), formatted naive `YYYY-MM-DD HH:MM:SS`.
 * The first ten characters are the calendar day in that same naive clock,
 * which is also how the dialog turns a picked day back into a bound (it
 * appends a UTC midnight / end-of-day to the date string), so no timezone
 * conversion happens on either side of the comparison.
 */
export interface DateBounds {
  /** First day with data, `yyyy-MM-dd`. */
  min: string
  /** Last day with data, `yyyy-MM-dd`. */
  max: string
}

const DAY = /^\d{4}-\d{2}-\d{2}/

/** `null` when either end is missing or unparseable — the inputs then stay
 *  unbounded rather than guessing a range the data may not have. */
export function dateBoundsFrom(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): DateBounds | null {
  const min = startTime?.match(DAY)?.[0]
  const max = endTime?.match(DAY)?.[0]
  return min && max ? { min, max } : null
}

/**
 * Why the typed range cannot be submitted, or `null` when it can (or when it
 * is still half-typed — an empty field is not yet an error). `yyyy-MM-dd`
 * compares correctly as a string, so no Date is built here.
 *
 * The browser's own `min`/`max` on a date input only constrain the PICKER; a
 * typed value outside them is still accepted as the input's value, so this
 * check — not the attributes — is the guard.
 */
export function validationWindowError(
  from: string,
  to: string,
  bounds: DateBounds | null,
): string | null {
  if (bounds) {
    if (from && from < bounds.min)
      return `Start can't be before the first day of data (${bounds.min}).`
    if (from && from > bounds.max)
      return `Start can't be after the last day of data (${bounds.max}).`
    if (to && to > bounds.max)
      return `End can't be after the last day of data (${bounds.max}).`
    if (to && to < bounds.min)
      return `End can't be before the first day of data (${bounds.min}).`
  }
  if (from && to && from > to) return 'Start must be on or before the end.'
  return null
}
