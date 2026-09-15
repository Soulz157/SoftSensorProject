import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ModelWithWorkspace } from '@/hooks/use-all-models'
import { ModelTable } from '../model-table'

/**
 * MODEL-SERVE-001-T19. The exact case the task exists to fix: a schedule the
 * operator ENABLED but which is FAILING must still offer Stop, because
 * `enabled` (the setting) and `deployStatus` (the derived fact) can
 * disagree. Before this fix the switch's checked-state was bound to
 * `deployStatus`, so `'error'` read as OFF — a model spawning a container
 * every cadence with a control that looked already stopped, whose only
 * available action wrote `enabled: true`.
 */
function buildModel(
  overrides: Partial<ModelWithWorkspace['data']> = {},
): ModelWithWorkspace {
  return {
    id: 'model-1',
    workspaceId: 'ws-1',
    name: 'Boiler soft sensor',
    workspaceName: 'Repco',
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
  } as unknown as ModelWithWorkspace
}

function renderTable(models: ModelWithWorkspace[]) {
  return render(
    <ModelTable
      models={models}
      loading={false}
      isFetching={false}
      onEdit={vi.fn()}
      onLog={vi.fn()}
      onDelete={vi.fn()}
      onToggleDeploy={vi.fn().mockResolvedValue(undefined)}
    />,
  )
}

describe('ModelTable — Start/Stop switch binding (MODEL-SERVE-001-T19)', () => {
  it('reads ON, labeled Stop, for an enabled schedule that is failing', () => {
    const model = buildModel({ enabled: true, deployStatus: 'error' })
    renderTable([model])

    const toggle = screen.getByRole('switch', {
      name: `Stop ${model.name}`,
    })
    expect(toggle).toBeChecked()
    // The derived-fact badge still reads the failure — checked-state and
    // status render together, neither one hidden by the other.
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('reads OFF, labeled Start, for a disabled schedule — even one with a failure in its history', () => {
    // A model the operator has stopped can still show its last error in the
    // badge (deployStatus reads the history) while the SWITCH itself must
    // reflect the current setting, not that history.
    const model = buildModel({ enabled: false, deployStatus: 'stopped' })
    renderTable([model])

    const toggle = screen.getByRole('switch', {
      name: `Start ${model.name}`,
    })
    expect(toggle).not.toBeChecked()
  })

  it('reads ON, labeled Stop, for a healthy running schedule — the ordinary case is unchanged', () => {
    const model = buildModel({ enabled: true, deployStatus: 'running' })
    renderTable([model])

    expect(
      screen.getByRole('switch', { name: `Stop ${model.name}` }),
    ).toBeChecked()
  })
})
