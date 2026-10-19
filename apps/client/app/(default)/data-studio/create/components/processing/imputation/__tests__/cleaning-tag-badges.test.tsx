import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CLEANING_BADGES_COLLAPSE_FROM,
  CleaningTagBadges,
} from '../cleaning-tag-badges'

const tags = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`)

describe('CleaningTagBadges', () => {
  it('renders nothing without tags', () => {
    const { container } = render(
      <CleaningTagBadges tags={[]} onRemove={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the pills with no toggle for a short batch', () => {
    render(
      <CleaningTagBadges
        tags={tags(CLEANING_BADGES_COLLAPSE_FROM)}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.getByText('T12')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View tags/ })).toBeNull()
  })

  it('folds 128 tags to one line until View tags is pressed', async () => {
    const onRemove = vi.fn()
    render(<CleaningTagBadges tags={tags(128)} onRemove={onRemove} />)
    expect(screen.getByText('128')).toBeInTheDocument()
    expect(screen.queryByText('T1')).toBeNull()

    const toggle = screen.getByRole('button', { name: /View tags/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)

    expect(screen.getByText('T128')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hide tags/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove T7 from cleaning' }),
    )
    expect(onRemove).toHaveBeenCalledWith('T7')

    await userEvent.click(screen.getByRole('button', { name: /Hide tags/ }))
    expect(screen.queryByText('T1')).toBeNull()
  })
})
