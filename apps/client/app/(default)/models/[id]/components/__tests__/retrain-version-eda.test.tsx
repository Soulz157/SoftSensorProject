import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * MODEL-SERVE-017. The read-only EDA panel on the dataset a retrain will
 * train on.
 *
 * Two of these are correctness, not cosmetics:
 *  - `showTransforms` MUST be false. That dialog writes
 *    `dwScalerConfigsAtom`, so leaving it on would let an operator reviewing
 *    a dataset here silently edit an unrelated Data Studio draft's pipeline.
 *  - `datasetId` and `artifactId` MUST both reach the card. That pair is what
 *    routes its server-backed tabs through the dataset-scoped endpoints;
 *    without it the card falls back to the `dw*` draft atoms and analyses
 *    whichever dataset draft the wizard last left behind.
 */

const h = vi.hoisted(() => ({
  cardProps: [] as Array<Record<string, unknown>>,
  rowsArgs: [] as Array<unknown[]>,
}))

vi.mock(
  '@/app/(default)/data-studio/create/components/processing/data-analysis-card',
  () => ({
    DataAnalysisCard: (props: Record<string, unknown>) => {
      h.cardProps.push(props)
      return <div data-testid="analysis-card" />
    },
  }),
)

vi.mock('@/hooks/dataset/artifact/use-artifact-rows', () => ({
  useArtifactRows: (...args: unknown[]) => {
    h.rowsArgs.push(args)
    return { sample: null, totalRowCount: null, loading: false, error: null }
  },
}))

import { RetrainVersionEda } from '../retrain-version-eda'

beforeEach(() => {
  h.cardProps.length = 0
  h.rowsArgs.length = 0
})

describe('RetrainVersionEda', () => {
  it('renders nothing until a dataset and artifact are both known', () => {
    const { container } = render(
      <RetrainVersionEda datasetId={null} artifactId={null} tags={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('fetches no rows until the section is opened', async () => {
    const user = userEvent.setup()
    render(
      <RetrainVersionEda
        datasetId="ds-1"
        artifactId="art-1"
        tags={['TI-101']}
      />,
    )

    // Mounted but collapsed: the hook is called with null ids so it no-ops.
    // This dialog is opened and closed often; an unexpanded panel must not
    // cost a request.
    expect(h.rowsArgs.at(-1)?.slice(0, 2)).toEqual([null, null])
    expect(screen.queryByTestId('analysis-card')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Explore this data/i }))

    expect(h.rowsArgs.at(-1)?.slice(0, 2)).toEqual(['ds-1', 'art-1'])
    expect(screen.getByTestId('analysis-card')).toBeInTheDocument()
  })

  it('never mounts the transforms dialog, which writes the data-studio store', async () => {
    const user = userEvent.setup()
    render(
      <RetrainVersionEda
        datasetId="ds-1"
        artifactId="art-1"
        tags={['TI-101']}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Explore this data/i }))

    expect(h.cardProps.at(-1)?.showTransforms).toBe(false)
  })

  it('passes both ids so the card reads the artifact, not a draft atom', async () => {
    const user = userEvent.setup()
    render(
      <RetrainVersionEda
        datasetId="ds-1"
        artifactId="art-1"
        tags={['TI-101']}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Explore this data/i }))

    const props = h.cardProps.at(-1)!
    expect(props.datasetId).toBe('ds-1')
    expect(props.artifactId).toBe('art-1')
    // The dialog has no wizard tag sidebar, so the card's own selector is the
    // only visibility control available.
    expect(props.showTagSelector).toBe(true)
  })
})
