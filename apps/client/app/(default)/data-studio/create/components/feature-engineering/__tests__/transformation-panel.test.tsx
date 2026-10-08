/**
 * DS-LAKE-028-T04. Two things this dialog must say, both of which it did not.
 *
 * `none` was always a real method server-side (softsensor_scaling/scaling.py
 * returns the column untransformed and records no fitted params) but had no
 * option here, so the user could pick WHICH scaling, never DECLINE it. And
 * `dwScalerConfigsAtom` starts {} against a DEFAULT_SCALER of minmax, so never
 * opening this dialog min-max scales every numeric column — silently.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FeatureTransformDialog } from '../transformation-panel'

function openDialog() {
  render(
    <FeatureTransformDialog
      numericColumns={['TI-101', 'VI-202']}
      categoricalColumns={[]}
      scalerConfigs={{}}
      setScalerConfig={vi.fn()}
    />,
  )
  screen.getByRole('button', { name: /feature transformation/i }).click()
}

describe('FeatureTransformDialog scaling options', () => {
  it('offers a no-scaling option so the user can decline', async () => {
    openDialog()
    const group = await screen.findByRole('radiogroup', {
      name: /scaling method/i,
    })
    expect(
      within(group).getByRole('radio', { name: /no scaling/i }),
    ).toBeInTheDocument()
  })

  it('states that unconfigured columns are min-max scaled by default', async () => {
    openDialog()
    // The assertion is on the DEFAULT being named, not merely on some copy
    // existing: a dialog that lists four methods and says nothing about what
    // happens when it is never opened is the state this task found.
    expect(
      await screen.findByText(/min-max scaled to a 0–1 range/i),
    ).toBeInTheDocument()
  })
})
