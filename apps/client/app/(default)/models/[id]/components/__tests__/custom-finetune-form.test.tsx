import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CustomFinetuneForm } from '../custom-finetune-form'

/**
 * MODEL-FLOW-024. The Custom Finetune list is the same curated shortlist Auto
 * Finetune searches, so it has to be sized the same way — which it can only do
 * if the form tells the server WHICH model it is for. It has no split stats of
 * its own (it lives on the model-detail page, not Step 3).
 */
const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/tuning-grid', () => ({
  tuningGridService: { get: h.get },
}))

const grid = (sized: boolean) => ({
  algorithm: 'xgboost',
  variants: [
    { n_estimators: 100, learning_rate: 0.05, max_depth: 3 },
    { n_estimators: 50, learning_rate: 0.1, max_depth: 2 },
  ],
  maxVariantsPerJob: 4,
  tier: sized ? 'tiny' : 'medium',
  sized,
})

describe('CustomFinetuneForm — sized to the model (MODEL-FLOW-024)', () => {
  beforeEach(() => {
    h.get.mockReset()
  })

  it('asks the server for this model’s variants, by modelId', async () => {
    h.get.mockResolvedValue(grid(true))
    render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
        modelId="model-1"
      />,
    )

    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('xgboost', undefined, 'model-1'),
    )
  })

  it('says the list is sized only when the server says it differs from the general one', async () => {
    h.get.mockResolvedValue(grid(true))
    render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
        modelId="model-1"
      />,
    )

    expect(
      await screen.findByText(/Sized to this model’s own data/),
    ).toBeInTheDocument()
  })

  it('stays silent for the general list', async () => {
    h.get.mockResolvedValue(grid(false))
    render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
        modelId="model-1"
      />,
    )

    await screen.findByText(/n_estimators=100/)
    expect(
      screen.queryByText(/Sized to this model’s own data/),
    ).not.toBeInTheDocument()
  })

  it('defaults to the first variant of the SIZED list, so Start is actionable', async () => {
    h.get.mockResolvedValue(grid(true))
    const onChange = vi.fn()
    render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={onChange}
        modelId="model-1"
      />,
    )

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        n_estimators: 100,
        learning_rate: 0.05,
        max_depth: 3,
      }),
    )
  })

  it('refetches when the model changes, so one model’s list is never shown for another', async () => {
    h.get.mockResolvedValue(grid(true))
    const { rerender } = render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
        modelId="model-1"
      />,
    )
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))

    rerender(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
        modelId="model-2"
      />,
    )

    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2))
    expect(h.get).toHaveBeenLastCalledWith('xgboost', undefined, 'model-2')
  })

  it('still works without a modelId, as before', async () => {
    h.get.mockResolvedValue(grid(false))
    render(
      <CustomFinetuneForm
        algorithm="xgboost"
        hyperparameters={null}
        onChange={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('xgboost', undefined, undefined),
    )
  })
})
