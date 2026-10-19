import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ZeroReadingTag } from '@/lib/zero-readings'
import { ZeroReadingsNotice } from '../zero-readings-notice'

const tags = (n: number): ZeroReadingTag[] =>
  Array.from({ length: n }, (_, i) => ({
    tag: `T${i + 1}`,
    zeros: 100 - i,
    readings: 1000,
    share: (100 - i) / 1000,
  }))

describe('ZeroReadingsNotice', () => {
  it('renders nothing without suggestions', () => {
    const { container } = render(
      <ZeroReadingsNotice suggestions={[]} onTreatAsMissing={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('stays short for many tags: three named, the rest behind "+N more"', () => {
    render(
      <ZeroReadingsNotice suggestions={tags(40)} onTreatAsMissing={vi.fn()} />,
    )
    expect(screen.getByText('40 tags read exactly 0 often')).toBeInTheDocument()
    expect(screen.getByText('T3')).toBeInTheDocument()
    expect(screen.queryByText('T4')).toBeNull()
    expect(screen.getByRole('button', { name: /\+37 more/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('opens the rest in a capped list, with exact counts in each tooltip', async () => {
    render(
      <ZeroReadingsNotice suggestions={tags(40)} onTreatAsMissing={vi.fn()} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /\+37 more/ }))
    const list = screen.getByTestId('zero-readings-more')
    expect(list).toHaveClass('max-h-40', 'overflow-y-auto')
    expect(within(list).getAllByRole('listitem')).toHaveLength(37)
    expect(
      within(list).getByTitle('61 of 1,000 loaded readings are exactly 0'),
    ).toHaveTextContent('T40')
  })

  it('the button applies the suggestion', async () => {
    const onTreatAsMissing = vi.fn()
    render(
      <ZeroReadingsNotice
        suggestions={tags(2)}
        onTreatAsMissing={onTreatAsMissing}
      />,
    )
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Treat zeros as missing' }),
    )
    expect(onTreatAsMissing).toHaveBeenCalledTimes(1)
  })
})
