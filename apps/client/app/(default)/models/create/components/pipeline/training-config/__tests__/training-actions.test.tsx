import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TrainState } from '@/store/model-pipeline'
import { TrainingActions } from '../training-actions'

/**
 * MODEL-FLOW-036. Step 3's one action block: the same button trains the base
 * models or fine-tunes, with the label and estimate the caller passes.
 */

type Props = Parameters<typeof TrainingActions>[0]

function props(overrides: Partial<Props> = {}): Props {
  return {
    estimate: {
      rows: 1000,
      features: 3,
      targets: 1,
      algorithms: ['ols'],
      findBestParams: false,
    },
    train: { status: 'idle', progress: 0 },
    label: 'Start Training',
    onStart: vi.fn(),
    disabled: false,
    refusal: null,
    dirty: false,
    doneText: 'Training complete.',
    ...overrides,
  }
}

const training: TrainState = {
  status: 'training',
  progress: 0,
  lastLog: 'fitting ols',
}

describe('TrainingActions (MODEL-FLOW-036)', () => {
  it('idle: shows the estimate heading and the label, and starts on click', () => {
    const onStart = vi.fn()
    render(<TrainingActions {...props({ onStart })} />)
    expect(
      screen.getByRole('heading', { name: 'Estimated runtime' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start Training/ }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('names the fine-tune mode with the label it is given', () => {
    render(<TrainingActions {...props({ label: 'Start Fine-tune' })} />)
    expect(
      screen.getByRole('button', { name: /Start Fine-tune/ }),
    ).toBeInTheDocument()
  })

  it('states its refusal and the unapplied-edits hint while idle', () => {
    render(
      <TrainingActions
        {...props({ refusal: 'Cannot start.', dirty: true, disabled: true })}
      />,
    )
    expect(screen.getByText('Cannot start.')).toBeInTheDocument()
    expect(screen.getByText(/Apply the changes above/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Start Training/ }),
    ).toBeDisabled()
  })

  it('while training shows progress and the latest log line, hiding the refusal', () => {
    render(
      <TrainingActions
        {...props({ train: training, refusal: 'hidden', disabled: true })}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Training progress' }),
    ).toBeInTheDocument()
    expect(screen.getByText('fitting ols')).toBeInTheDocument()
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Training…/ })).toBeDisabled()
  })

  it('shows the error, and the done text keeps the label (no Retrain)', () => {
    const { rerender } = render(
      <TrainingActions
        {...props({ train: { status: 'error', progress: 0, error: 'boom' } })}
      />,
    )
    expect(screen.getByText('boom')).toBeInTheDocument()

    rerender(
      <TrainingActions
        {...props({ train: { status: 'done', progress: 100 } })}
      />,
    )
    expect(screen.getByText('Training complete.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Start Training/ }),
    ).toBeInTheDocument()
  })
})
