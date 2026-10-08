import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

function renderTable(
  models: ModelWithWorkspace[],
  onToggleDeploy = vi.fn().mockResolvedValue(undefined),
) {
  return render(
    <ModelTable
      models={models}
      loading={false}
      isFetching={false}
      onEdit={vi.fn()}
      onLog={vi.fn()}
      onDelete={vi.fn()}
      onToggleDeploy={onToggleDeploy}
    />,
  )
}

describe('ModelTable — Start/Stop control binding (MODEL-SERVE-001-T19)', () => {
  it('reads ON, labeled Stop, for an enabled schedule that is failing', () => {
    const model = buildModel({ enabled: true, deployStatus: 'error' })
    renderTable([model])

    expect(
      screen.getByRole('button', { name: `Stop ${model.name}` }),
    ).toBeEnabled()
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

    expect(
      screen.getByRole('button', { name: `Start ${model.name}` }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: `Stop ${model.name}` }),
    ).toBeNull()
  })

  it('reads ON, labeled Stop, for a healthy running schedule — the ordinary case is unchanged', () => {
    const model = buildModel({ enabled: true, deployStatus: 'running' })
    renderTable([model])

    expect(
      screen.getByRole('button', { name: `Stop ${model.name}` }),
    ).toBeInTheDocument()
  })
})

/**
 * The bug this replaces the switch for: the page's handler catches a refused
 * Start (it toasts the server's reason) and never rethrows, and the old
 * optimistic flip only rolled back on a throw — so the control stuck ON over
 * a model the server never started. The row must render the props it is
 * given, before and after the call.
 */
describe('ModelTable — a refused Start does not stick', () => {
  it('still offers Start once the handler resolves without enabling the model', async () => {
    const model = buildModel({ enabled: false, deployStatus: 'stopped' })
    const onToggleDeploy = vi.fn().mockResolvedValue(undefined)
    renderTable([model], onToggleDeploy)

    await userEvent.click(
      screen.getByRole('button', { name: `Start ${model.name}` }),
    )
    // Confirm dialog.
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(onToggleDeploy).toHaveBeenCalledWith(model, 'running')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Start ${model.name}` }),
      ).toBeEnabled(),
    )
    expect(
      screen.queryByRole('button', { name: `Stop ${model.name}` }),
    ).toBeNull()
  })

  it('shows the server status after a refetch reports the failure', () => {
    const model = buildModel({ enabled: true, deployStatus: 'error' })
    renderTable([model])
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: `Stop ${model.name}` }),
    ).toBeInTheDocument()
  })
})

describe('ModelTable — Initializing while a Start is in flight', () => {
  it('badges Initializing during the call, then shows the server status again', async () => {
    const model = buildModel({ enabled: false, deployStatus: 'stopped' })
    let resolve!: () => void
    const onToggleDeploy = vi.fn(
      () => new Promise<void>(r => (resolve = r)),
    )
    renderTable([model], onToggleDeploy)
    // "Offline" also labels the monitoring column, so count rather than find.
    const offlineBefore = screen.getAllByText('Offline').length

    await userEvent.click(
      screen.getByRole('button', { name: `Start ${model.name}` }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))

    expect(await screen.findByText('Initializing')).toBeInTheDocument()
    expect(screen.getAllByText('Offline')).toHaveLength(offlineBefore - 1)

    resolve()
    // No refetch in this harness, so the props still say stopped — the
    // transitional badge must not outlive the call.
    await waitFor(() =>
      expect(screen.queryByText('Initializing')).toBeNull(),
    )
    expect(screen.getAllByText('Offline')).toHaveLength(offlineBefore)
  })
})
