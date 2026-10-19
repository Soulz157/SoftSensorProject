import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FeatureConfig } from '@/lib/feature-engineering'
import { ExtractionPanel } from '../extraction-panel'

const FEATURES: FeatureConfig[] = [
  { id: 'auto:1', kind: 'delta', tag: 'FI-1' },
  { id: 'auto:2', kind: 'arith', op: 'sub', tags: ['FI-1', 'TI-2'] },
  {
    id: 'auto:3',
    kind: 'group',
    name: 'AI602__grp_mean',
    tags: ['AI602A.PV', 'AI602B.PV'],
    agg: 'mean',
  },
  { id: 'auto:4', kind: 'datetime', part: 'hourSin' },
  { id: 'f', kind: 'formula', name: 'sum', expr: 'c0', vars: { c0: 'FI-1' } },
]

describe('ExtractionPanel feature list', () => {
  it('lists every non-formula feature, so auto ones can be removed one by one', async () => {
    const onRemove = vi.fn()
    render(
      <ExtractionPanel
        sourceColumns={['FI-1', 'TI-2']}
        features={FEATURES}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    )
    for (const col of [
      'FI-1__delta',
      'FI-1__sub__TI-2',
      'AI602__grp_mean',
      '__dt_hourSin',
    ])
      expect(screen.getByText(col)).toBeInTheDocument()
    expect(screen.queryByText('sum')).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove AI602__grp_mean' }),
    )
    expect(onRemove).toHaveBeenCalledWith('auto:3')
  })
})
