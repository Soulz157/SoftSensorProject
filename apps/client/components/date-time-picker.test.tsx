import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateTimePicker } from './date-time-picker'

/**
 * Regression for "cannot select the last day/month" in the split-holdout
 * pickers. Root cause: with `value=""` (nothing committed yet), the
 * component shows a "now" placeholder for day/month — but every Select was
 * rendered CONTROLLED with that placeholder as its `value`. Radix's
 * `useControllableState` only calls `onValueChange` when the clicked item's
 * value differs from the current controlled `value` — so clicking the exact
 * day/month already displayed (which happens whenever "now" falls inside, or
 * at the edge of, the allowed range — e.g. a dataset fetched "up to today")
 * silently did nothing.
 *
 * Deliberately uses the REAL clock rather than `vi.useFakeTimers()`: Radix
 * Select's open/position logic and `userEvent`'s pointer dispatch both lean
 * on real `requestAnimationFrame`/timer ticks, and faking them hangs every
 * interaction (`user.click` on the trigger never resolves) regardless of
 * `advanceTimers`. `max` is instead pinned to TODAY, computed from the real
 * `Date`, which reproduces the identical "now == last valid day" collision
 * without mocking the clock.
 */
const pad = (n: number) => n.toString().padStart(2, '0')
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function today() {
  const now = new Date()
  return {
    day: now.getDate(),
    month: now.getMonth() + 1, // 1-12
    year: now.getFullYear(),
    // Six months back, clamped to day 1 — always <= today regardless of
    // which day-of-month "now" is.
    min: `${now.getFullYear()}-${pad(Math.max(1, now.getMonth() - 5))}-01T00:00`,
    max: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:50`,
  }
}

// `getAllByRole(...)[index]` types as possibly-`undefined`; narrow explicitly
// rather than asserting, since a missing combobox means the test itself is
// broken and should fail loudly at the click, not with a vague type error.
function comboboxAt(index: number): HTMLElement {
  const el = screen.getAllByRole('combobox')[index]
  if (!el) throw new Error(`Expected a combobox at index ${index}`)
  return el
}

describe('DateTimePicker', () => {
  it('fires onChange when clicking the day already shown as the placeholder', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    const { day, min, max } = today()

    render(<DateTimePicker value="" min={min} max={max} onChange={onChange} />)

    // DOM order is Day, Month, Year, Hour, Minute (date-time-picker.tsx) —
    // no `aria-label` ties each trigger's accessible name to its `Segment`
    // label, so index is the stable way to target one from a test.
    await user.click(comboboxAt(0))
    await user.click(screen.getByRole('option', { name: pad(day) }))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('fires onChange when clicking the month already shown as the placeholder', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    const { month, min, max } = today()

    render(<DateTimePicker value="" min={min} max={max} onChange={onChange} />)

    await user.click(comboboxAt(1))
    await user.click(screen.getByRole('option', { name: MONTHS[month - 1] }))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('still fires onChange for a genuinely new day once a value is committed', async () => {
    const user = userEvent.setup({ delay: null })
    const onChange = vi.fn()
    const { day, month, year, min, max } = today()
    // A real committed value (today), and a target day one away from it —
    // whichever direction stays inside [1, today] so it's never disabled.
    const targetDay = day > 1 ? day - 1 : 2
    const value = `${year}-${pad(month)}-${pad(day)}T00:00`

    render(
      <DateTimePicker value={value} min={min} max={max} onChange={onChange} />,
    )

    await user.click(comboboxAt(0))
    await user.click(screen.getByRole('option', { name: pad(targetDay) }))

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
