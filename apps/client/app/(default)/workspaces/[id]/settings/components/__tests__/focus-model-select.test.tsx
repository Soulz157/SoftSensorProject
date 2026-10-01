import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FocusModelSelect } from '../focus-model-select'
import type { WorkspaceModel } from '@/types'

/** MODEL-SERVE-022-D-FOCUS — the channel's focus-model allow-list. */
const MODELS = ['A', 'B', 'C'].map(
  id =>
    ({
      id,
      name: `Model ${id}`,
      workspaceId: 'ws',
      data: null,
    }) as WorkspaceModel,
)

function open(selected: string[], onChange = vi.fn()) {
  render(
    <FocusModelSelect
      models={MODELS}
      selected={selected}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Focus models' }))
  return onChange
}

describe('FocusModelSelect', () => {
  it('reads "All models" when every model is selected', () => {
    render(
      <FocusModelSelect
        models={MODELS}
        selected={['A', 'B', 'C']}
        onChange={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Focus models' }),
    ).toHaveTextContent('All models (3)')
  })

  it('Select all picks every model, Clear empties the list', () => {
    const onChange = open(['A'])
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onChange).toHaveBeenLastCalledWith(['A', 'B', 'C'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('adds a model in workspace order, not click order', () => {
    const onChange = open(['C'])
    fireEvent.click(
      screen.getByText('Model A').closest('label')!.querySelector('button')!,
    )
    expect(onChange).toHaveBeenCalledWith(['A', 'C'])
  })
})
