import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AIModel } from '@/types'
import { ModelDetailDialog } from '../model-detail-dialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

/**
 * MODEL-SERVE-001-T22. Both maps in this dialog used to key on values the
 * wire never sends, and both failed SILENTLY through a `??` fallback rather
 * than throwing — so the only way to catch a regression is to assert the
 * rendered word, not the map's shape.
 */
function buildModel(overrides: Partial<AIModel['data']> = {}): AIModel {
  return {
    id: 'model-1',
    workspaceId: 'ws-1',
    name: 'Boiler soft sensor',
    data: {
      deployStatus: 'stopped',
      enabled: false,
      prodStatus: 'normal',
      editHistory: [],
      logs: [],
      ...overrides,
    },
    nodesId: null,
    datasetId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as AIModel
}

function renderDialog(model: AIModel) {
  return render(<ModelDetailDialog model={model} open onClose={vi.fn()} />)
}

describe('ModelDetailDialog deploy badge (MODEL-SERVE-001-T22)', () => {
  it('renders a failing model as "Failed", never falling through to "Stopped"', () => {
    // The exact contradiction this task exists to fix: keyed `failed`, this
    // lookup missed on the real wire value 'error' and fell back to
    // DEPLOY_MAP.stopped, printing "Deploy: Stopped" immediately above the
    // component's own red "Model is in error state" banner.
    renderDialog(buildModel({ deployStatus: 'error' }))

    expect(screen.getByText(/Deploy: Failed/)).toBeInTheDocument()
    expect(screen.queryByText(/Deploy: Stopped/)).not.toBeInTheDocument()
  })

  it('carries the red treatment on that badge, not the muted stopped one', () => {
    renderDialog(buildModel({ deployStatus: 'error' }))

    const badge = screen.getByText(/Deploy: Failed/).closest('span')
    expect(badge?.className).toContain('text-red-500')
    expect(badge?.className).not.toContain('text-zinc-400')
  })

  it('still renders the other deploy statuses it always did', () => {
    renderDialog(buildModel({ deployStatus: 'running' }))
    expect(screen.getByText(/Deploy: Running/)).toBeInTheDocument()
  })
})

describe('ModelDetailDialog production badge (MODEL-SERVE-001-T22)', () => {
  it('renders a frozen model as "Data Frozen", never falling through to "Normal"', () => {
    // `frozen` is the fifth prodStatus value and was absent from PROD_MAP,
    // so it took the `?? PROD_MAP.normal` fallback and read green "Normal"
    // — a model whose data is frozen reporting as healthy.
    renderDialog(buildModel({ prodStatus: 'frozen' }))

    expect(screen.getByText(/Prod: Data Frozen/)).toBeInTheDocument()
    expect(screen.queryByText(/Prod: Normal/)).not.toBeInTheDocument()
  })

  it('does not paint a frozen model with the healthy green treatment', () => {
    renderDialog(buildModel({ prodStatus: 'frozen' }))

    const badge = screen.getByText(/Prod: Data Frozen/).closest('span')
    expect(badge?.className).not.toContain('text-emerald-500')
  })
})
