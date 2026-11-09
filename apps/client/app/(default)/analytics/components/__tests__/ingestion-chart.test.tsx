import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IngestionChart } from '../ingestion-chart'

describe('IngestionChart', () => {
  it('says why it is empty instead of drawing a flat chart', () => {
    render(
      <IngestionChart
        range="24h"
        points={[
          {
            bucketStart: '2026-11-06T10:00:00.000Z',
            scheduledRows: 0,
            predictRows: 0,
            badCellPct: null,
          },
        ]}
      />,
    )
    expect(
      screen.getByText(/No input arrived in this range/),
    ).toBeInTheDocument()
    expect(screen.getByText('Last 24h, hourly')).toBeInTheDocument()
  })

  it('labels the bucket size for the selected range', () => {
    render(<IngestionChart range="1y" points={[]} />)
    expect(screen.getByText('Last 1y, weekly')).toBeInTheDocument()
  })
})
