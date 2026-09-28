import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HYPERPARAMS } from '@/lib/training-config'
import { finetuneStartingHyperparams } from '@/lib/retrain-finetune'
import type { HyperparamValue } from '@/store/model-pipeline'
import { CustomFinetuneForm } from '../custom-finetune-form'

/**
 * Custom Finetune reuses the model wizard's own split control and
 * hyperparameter table. The table opens on the current version's own values;
 * the curated variants (MODEL-FLOW-024 — sized to THIS model, which is why
 * the form passes `modelId`) are a "Fill from" shortcut above it.
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

function renderForm(
  overrides: Partial<Parameters<typeof CustomFinetuneForm>[0]> = {},
) {
  const props: Parameters<typeof CustomFinetuneForm>[0] = {
    algorithm: 'xgboost',
    incumbentHyperparameters: { n_estimators: 350 },
    hyperparameters: null,
    onChange: vi.fn(),
    trainSplit: 80,
    onTrainSplitChange: vi.fn(),
    modelId: 'model-1',
    ...overrides,
  }
  return { props, ...render(<CustomFinetuneForm {...props} />) }
}

function fieldLabel(key: string): string {
  const field = HYPERPARAMS.xgboost.find(f => f.key === key)
  if (!field) throw new Error(`xgboost has no ${key} field`)
  return field.label
}

describe('CustomFinetuneForm — the wizard table, split and variants', () => {
  beforeEach(() => {
    h.get.mockReset()
    h.get.mockResolvedValue(grid(false))
  })

  it("opens the table on the current version's own values, over the defaults", async () => {
    const onChange = vi.fn()
    renderForm({ onChange })

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        finetuneStartingHyperparams('xgboost', { n_estimators: 350 }),
      ),
    )
  })

  it('writes an edited field back into the whole record', () => {
    const hyperparameters: Record<string, HyperparamValue> =
      finetuneStartingHyperparams('xgboost', { n_estimators: 350 })
    const onChange = vi.fn()
    renderForm({ hyperparameters, onChange })

    fireEvent.change(screen.getByLabelText(fieldLabel('n_estimators')), {
      target: { value: '500' },
    })

    expect(onChange).toHaveBeenLastCalledWith({
      ...hyperparameters,
      n_estimators: 500,
    })
  })

  it("reuses the wizard's split presets and reports the picked percent", async () => {
    const user = userEvent.setup()
    const onTrainSplitChange = vi.fn()
    renderForm({ onTrainSplitChange })

    expect(screen.getByText(/Train 80% · Test 20%/)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '70:30' }))

    expect(onTrainSplitChange).toHaveBeenCalledWith(70)
  })

  it('disables every control while a retrain cannot start', () => {
    renderForm({
      disabled: true,
      hyperparameters: finetuneStartingHyperparams('xgboost', null),
    })

    expect(screen.getByLabelText(fieldLabel('n_estimators'))).toBeDisabled()
  })

  it('says so, instead of a table, for an algorithm the table does not know', () => {
    renderForm({ algorithm: 'not-an-algorithm' })

    expect(
      screen.getByText(/has no editable hyperparameters here/),
    ).toBeInTheDocument()
  })
})

describe('CustomFinetuneForm — variants sized to the model (MODEL-FLOW-024)', () => {
  beforeEach(() => {
    h.get.mockReset()
  })

  it('asks the server for this model’s variants, by modelId', async () => {
    h.get.mockResolvedValue(grid(true))
    renderForm()

    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('xgboost', undefined, 'model-1'),
    )
  })

  it('says the list is sized only when the server says it differs from the general one', async () => {
    h.get.mockResolvedValue(grid(true))
    renderForm()

    expect(
      await screen.findByText(/Sized to this model’s own data/),
    ).toBeInTheDocument()
  })

  it('stays silent for the general list', async () => {
    h.get.mockResolvedValue(grid(false))
    renderForm()

    // The placeholder changes once the variants have landed.
    await screen.findByText('Pick one to fill the table below')
    expect(
      screen.queryByText(/Sized to this model’s own data/),
    ).not.toBeInTheDocument()
  })

  it('refetches when the model changes, so one model’s list is never shown for another', async () => {
    h.get.mockResolvedValue(grid(true))
    const { props, rerender } = renderForm()
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(1))

    rerender(<CustomFinetuneForm {...props} modelId="model-2" />)

    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2))
    expect(h.get).toHaveBeenLastCalledWith('xgboost', undefined, 'model-2')
  })

  it('still works without a modelId, as before', async () => {
    h.get.mockResolvedValue(grid(false))
    renderForm({ modelId: undefined })

    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('xgboost', undefined, undefined),
    )
  })

  it('keeps the table usable when the variants cannot be loaded', async () => {
    h.get.mockRejectedValue(new Error('No tuning grid for "xgboost"'))
    renderForm({
      hyperparameters: finetuneStartingHyperparams('xgboost', null),
    })

    expect(
      await screen.findByText('No tuning grid for "xgboost"'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(fieldLabel('n_estimators'))).toBeEnabled()
  })
})
