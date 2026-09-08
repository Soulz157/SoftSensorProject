import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AIModel } from '@/types'
import { InputDataTab } from '../input-data-tab'

/**
 * The regression this tab exists to fix: a model with ZERO logged
 * `/predict` traffic must still show its full trained X feature list
 * (every status UNKNOWN) rather than the old empty state. Also covers the
 * legacy "no recorded feature columns" state and the Y target marker.
 */

const h = vi.hoisted(() => ({
  points: [] as unknown[],
  pointsLoading: false,
  pointsTruncated: false,
  drift: null as unknown,
  driftLoading: false,
  schema: null as unknown,
  schemaLoading: false,
  schemaError: null as string | null,
}))

vi.mock('@/hooks/model/use-prediction-monitoring', () => ({
  usePredictionMonitoring: () => ({
    points: h.points,
    pointsLoading: h.pointsLoading,
    pointsTruncated: h.pointsTruncated,
    drift: h.drift,
    driftLoading: h.driftLoading,
    driftUnavailableReason: null,
  }),
}))

vi.mock('@/hooks/model/use-model-input-schema', () => ({
  useModelInputSchema: () => ({
    schema: h.schema,
    loading: h.schemaLoading,
    error: h.schemaError,
  }),
}))

const MODEL = {
  id: 'model-1',
  workspaceId: 'ws-1',
  name: 'Boiler soft sensor',
  data: {
    deployStatus: 'stopped',
    prodStatus: 'offline',
    editHistory: [],
    logs: [],
  },
  nodesId: null,
  datasetId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  nodes: null,
} as unknown as AIModel

beforeEach(() => {
  h.points = []
  h.pointsLoading = false
  h.pointsTruncated = false
  h.drift = null
  h.driftLoading = false
  h.schema = null
  h.schemaLoading = false
  h.schemaError = null
})

describe('InputDataTab', () => {
  it('renders the full trained X list with UNKNOWN status when the model has served zero traffic', () => {
    h.schema = {
      modelId: 'model-1',
      versionId: 'version-1',
      version: 1,
      stage: 'STAGING',
      featureColumns: ['TI-101.PV', 'PI-204.PV', 'FC-310.PV'],
      unavailableReason: null,
      targetY: 'TI-900.PV',
      scalingParams: null,
    }
    h.points = []
    h.drift = null

    render(<InputDataTab model={MODEL} />)

    expect(screen.getByText('TI-101.PV')).toBeInTheDocument()
    expect(screen.getByText('PI-204.PV')).toBeInTheDocument()
    expect(screen.getByText('FC-310.PV')).toBeInTheDocument()
    expect(screen.getAllByText('UNKNOWN')).toHaveLength(3)
  })

  it('shows the honest legacy state when the training run recorded no feature columns', () => {
    h.schema = {
      modelId: 'model-1',
      versionId: 'version-1',
      version: 1,
      stage: 'STAGING',
      featureColumns: null,
      unavailableReason: 'This training run has no recorded manifest.',
      targetY: 'TI-900.PV',
      scalingParams: null,
    }

    render(<InputDataTab model={MODEL} />)

    expect(screen.getByText('No recorded feature columns')).toBeInTheDocument()
    expect(
      screen.getByText('This training run has no recorded manifest.'),
    ).toBeInTheDocument()
  })

  it('shows the loading skeleton, not the legacy empty state, before the schema fetch has started', () => {
    // `useModelInputSchema` starts with `schema: null, loading: false` —
    // `loading` only flips true once its debounced timer fires. Without
    // treating this window as loading too, the tab briefly reads
    // `!schema?.featureColumns` and flashes "No recorded feature columns"
    // for every model on first paint.
    h.schema = null
    h.schemaLoading = false
    h.schemaError = null

    render(<InputDataTab model={MODEL} />)

    expect(
      screen.queryByText('No recorded feature columns'),
    ).not.toBeInTheDocument()
  })

  it('marks the Y target distinctly from the X feature list', () => {
    h.schema = {
      modelId: 'model-1',
      versionId: 'version-1',
      version: 3,
      stage: 'PRODUCTION',
      featureColumns: ['TI-101.PV'],
      unavailableReason: null,
      targetY: 'TI-900.PV',
      scalingParams: null,
    }

    render(<InputDataTab model={MODEL} />)

    expect(screen.getByText('TI-900.PV')).toBeInTheDocument()
    expect(screen.getByText('Y')).toBeInTheDocument()
    // The target must not also appear as an X row.
    expect(screen.queryAllByText('TI-101.PV')).toHaveLength(1)
  })
})
