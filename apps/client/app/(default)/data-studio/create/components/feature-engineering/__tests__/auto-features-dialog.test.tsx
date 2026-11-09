import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FeatureConfig } from '@/lib/feature-engineering'
import { featureColumnName } from '@/lib/feature-engineering'
import { isAutoFeature } from '@/lib/auto-features'
import { AutoFeaturesDialog } from '../auto-features-dialog'

function renderDialog(
  over: Partial<React.ComponentProps<typeof AutoFeaturesDialog>> = {},
) {
  const onAdd = vi.fn<(configs: FeatureConfig[]) => void>()
  const onOpenChange = vi.fn()
  render(
    <AutoFeaturesDialog
      open
      onOpenChange={onOpenChange}
      sourceColumns={['FI-1', 'TI-2', 'Y.lab']}
      targetTag="Y.lab"
      criticalTags={[]}
      intervalMs={3_600_000}
      intervalSource="data"
      rowCount={null}
      existingColumns={['FI-1', 'TI-2', 'Y.lab']}
      onAdd={onAdd}
      {...over}
    />,
  )
  return { onAdd, onOpenChange }
}

const addButton = () =>
  screen.getByRole('button', { name: /^Add \d+ features$/ })

describe('AutoFeaturesDialog', () => {
  it('states the interval and lists only non-target source tags', () => {
    renderDialog()
    expect(screen.getByText(/1 h \(from the data\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('FI-1')).toBeInTheDocument()
    expect(screen.queryByLabelText('Y.lab')).toBeNull()
  })

  it('previews the default plan and adds it in one call', async () => {
    const { onAdd, onOpenChange } = renderDialog()
    // 2 tags: 10 lags + 16 rolling + 2 differences + 4 time (sin/cos).
    expect(addButton()).toHaveTextContent('Add 32 features')
    await userEvent.click(addButton())

    expect(onAdd).toHaveBeenCalledTimes(1)
    const configs = onAdd.mock.calls[0]![0]
    expect(configs).toHaveLength(32)
    expect(configs.every(isAutoFeature)).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('narrowing tags and families changes what is added', async () => {
    const { onAdd } = renderDialog()
    await userEvent.click(screen.getByLabelText('TI-2'))
    await userEvent.click(screen.getByLabelText(/^Rolling mean & std/))
    await userEvent.click(screen.getByLabelText(/^Lags/))
    await userEvent.click(screen.getByLabelText(/^Time cycle/))
    expect(addButton()).toHaveTextContent('Add 1 features')
    await userEvent.click(addButton())
    expect(onAdd.mock.calls[0]![0].map(featureColumnName)).toEqual([
      'FI-1__delta',
    ])
  })

  it('pairwise is disabled without two critical tags', () => {
    renderDialog({ criticalTags: ['FI-1'] })
    expect(screen.getByLabelText(/^Pairwise differences/)).toBeDisabled()
  })

  it('pairwise pairs the critical tags when there are two', async () => {
    const { onAdd } = renderDialog({ criticalTags: ['FI-1', 'TI-2'] })
    await userEvent.click(screen.getByLabelText(/^Pairwise differences/))
    await userEvent.click(addButton())
    expect(onAdd.mock.calls[0]![0].map(featureColumnName)).toContain(
      'FI-1__sub__TI-2',
    )
  })

  it('says why windows were left out, and disables Add when nothing is left', async () => {
    renderDialog({ intervalMs: null, intervalSource: null })
    expect(screen.getByText(/need the fetch interval/)).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText(/^Differences/))
    await userEvent.click(screen.getByLabelText(/^Time cycle/))
    expect(
      screen.getByText('Nothing to add with these choices.'),
    ).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('lists each loop found, and a loop can be left out', async () => {
    const { onAdd } = renderDialog({
      sourceColumns: ['AI602A.PV', 'AI602B.PV', 'FIC114A.PV', 'FIC114B.PV'],
      targetTag: null,
      existingColumns: [],
    })
    expect(
      screen.getByLabelText(/^AI602 \(AI602A.PV, AI602B.PV\)/),
    ).toBeChecked()
    for (const name of [
      /^Lags/,
      /^Rolling mean & std/,
      /^Differences/,
      /^Time cycle/,
    ])
      await userEvent.click(screen.getByLabelText(name))
    await userEvent.click(screen.getByLabelText(/^FIC114 \(/))
    await userEvent.click(addButton())
    expect(onAdd.mock.calls[0]![0].map(featureColumnName)).toEqual([
      'AI602__grp_mean',
      'AI602__grp_spread',
      'AI602__grp_min',
      'AI602__grp_max',
    ])
  })

  it('disables Loop aggregates when no loop has 2 tags', () => {
    renderDialog()
    expect(screen.getByLabelText(/^Loop aggregates/)).toBeDisabled()
  })
})
