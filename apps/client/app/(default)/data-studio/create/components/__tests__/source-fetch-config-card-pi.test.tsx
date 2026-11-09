import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import { DEFAULT_PI_CONFIG } from '@/store/model-pipeline'
import { SourceFetchConfigCard } from '../source-configs/source-fetch-config-card'

vi.mock('../add-connection-dialog', () => ({
  AddConnectionDialog: () => null,
  KIND_META: { aveva: { icon: () => null, label: 'AVEVA PI' } },
}))

const SOURCE: SavedDataSource = {
  id: 'src-1',
  name: 'Plant PI',
  type: 'aveva',
  host: 'pi-web.example',
  username: 'svc_softsensor',
  dbName: 'PIDB01',
  config: null,
  status: 'connected',
  lastUsed: '2026-10-19',
  createdBy: 'u-1',
}

describe('SourceFetchConfigCard — PI connection is read-only (2026-10-19)', () => {
  it('shows the saved connection the server fetches with', () => {
    render(
      <SourceFetchConfigCard
        source={SOURCE}
        config={{ ...DEFAULT_PI_CONFIG }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('pi-web.example')).toBeInTheDocument()
    expect(screen.getByText('PIDB01')).toBeInTheDocument()
    expect(screen.getByText('svc_softsensor')).toBeInTheDocument()
  })

  it('offers none of the fields that never reached a request', () => {
    render(
      <SourceFetchConfigCard
        source={SOURCE}
        config={{ ...DEFAULT_PI_CONFIG }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Calc Type')).toBeNull()
    expect(screen.queryByText('Password')).toBeNull()
    expect(screen.queryByText('Interval')).toBeNull()
  })

  it('names config.piServer when the source overrides it, like the backend', () => {
    render(
      <SourceFetchConfigCard
        source={{
          ...SOURCE,
          config: {
            piServer: 'PIOTHER',
          } as unknown as SavedDataSource['config'],
        }}
        config={{ ...DEFAULT_PI_CONFIG }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('PIOTHER')).toBeInTheDocument()
  })
})
