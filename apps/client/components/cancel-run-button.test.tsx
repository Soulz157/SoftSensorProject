import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CancelRunButton } from '@/components/cancel-run-button'

/**
 * A run that has gone for tens of minutes is thrown away by one click, so the
 * button asks first. These pin the three outcomes — open, keep, confirm — and
 * that the wording says what each subject really promises.
 */
function setup(over: Partial<Parameters<typeof CancelRunButton>[0]> = {}) {
  const onConfirm = vi.fn()
  render(
    <CancelRunButton
      subject="training"
      onConfirm={onConfirm}
      canceling={false}
      {...over}
    />,
  )
  return { onConfirm }
}

describe('CancelRunButton', () => {
  it('draws one Cancel button and no dialog until it is pressed', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('opens a confirmation on press and stops nothing yet', () => {
    const { onConfirm } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('"Keep running" closes the dialog and confirms nothing', () => {
    const { onConfirm } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep running' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('confirms exactly once, and only from the dialog', () => {
    const { onConfirm } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel training' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('says what a training cancel keeps', () => {
    setup({ subject: 'training' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel training?' })
    expect(dialog).toHaveTextContent('Anything that already finished is kept')
  })

  it('says what a retrain cancel leaves alone: no staged version, the current one untouched', () => {
    setup({ subject: 'retrain' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel retrain?' })
    expect(dialog).toHaveTextContent('No new version is staged')
    expect(dialog).toHaveTextContent('the current version is not touched')
    expect(
      screen.getByRole('button', { name: 'Cancel retrain' }),
    ).toBeInTheDocument()
  })

  it('shows Canceling… and cannot be pressed again while the request is in flight', () => {
    setup({ canceling: true })
    expect(screen.getByRole('button', { name: 'Canceling…' })).toBeDisabled()
  })

  it('uses the design system: outline for the trigger and Keep running, destructive for the confirm', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'data-variant',
      'outline',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByRole('button', { name: 'Keep running' }),
    ).toHaveAttribute('data-variant', 'outline')
    expect(
      screen.getByRole('button', { name: 'Cancel training' }),
    ).toHaveAttribute('data-variant', 'destructive')
  })

  it('draws an X on the trigger, not a stop square', () => {
    setup()
    const icon = screen
      .getByRole('button', { name: 'Cancel' })
      .querySelector('svg')
    expect(icon).toHaveClass('lucide-x')
    expect(icon).not.toHaveClass('lucide-square')
  })
})
