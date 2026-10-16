import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DEFAULT_FETCH_CONFIG,
  type HistoricalFetchConfig,
} from '@/lib/fetch-config'
import { HistoricalFetchConfigCard } from '../source-configs/historical-fetch-config-card'

/**
 * Batch Size is a plain text box (2026-10-16): it can be cleared and retyped,
 * only a valid 1..1000 value reaches the config, and an invalid one says why
 * once the field is left.
 */
function Harness({
  initial = DEFAULT_FETCH_CONFIG,
  spy,
}: {
  initial?: HistoricalFetchConfig
  spy: (c: HistoricalFetchConfig) => void
}) {
  const [config, setConfig] = useState(initial)
  return (
    <HistoricalFetchConfigCard
      config={config}
      onChange={next => {
        spy(next)
        setConfig(next)
      }}
    />
  )
}

const box = () => screen.getByLabelText('Batch Size') as HTMLInputElement

describe('HistoricalFetchConfigCard — Batch Size', () => {
  it('is a text box, not a number spinner', () => {
    render(<Harness spy={vi.fn()} />)
    expect(box().type).toBe('text')
    expect(box().inputMode).toBe('numeric')
    expect(box().value).toBe(String(DEFAULT_FETCH_CONFIG.batchSize))
  })

  it('can be cleared and retyped, sending only the finished valid value', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.clear(box())
    expect(box().value).toBe('')
    await userEvent.type(box(), '250')
    expect(box().value).toBe('250')
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ batchSize: 250 }),
    )
  })

  it('keeps the last valid value and explains, after leaving an invalid entry', async () => {
    const spy = vi.fn()
    render(<Harness spy={spy} />)
    await userEvent.clear(box())
    await userEvent.type(box(), '5000')
    await userEvent.tab()
    expect(box()).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByText(
        `Enter a whole number from 1 to 1000. Using 500 until then.`,
      ),
    ).toBeInTheDocument()
    // "500" was the last valid prefix typed on the way to "5000".
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ batchSize: 500 }),
    )
  })

  it('shows no error while the field has not been left', async () => {
    render(<Harness spy={vi.fn()} />)
    await userEvent.clear(box())
    expect(box()).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByText('Tags per request (1–1000).')).toBeInTheDocument()
  })

  it('follows a config that changes from outside (a resumed draft)', () => {
    const { rerender } = render(
      <HistoricalFetchConfigCard
        config={DEFAULT_FETCH_CONFIG}
        onChange={vi.fn()}
      />,
    )
    rerender(
      <HistoricalFetchConfigCard
        config={{ ...DEFAULT_FETCH_CONFIG, batchSize: 120 }}
        onChange={vi.fn()}
      />,
    )
    expect(box().value).toBe('120')
  })
})
