import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { mpServerDraftIdAtom } from '@/store/model-pipeline'
import { workspacesAtom } from '@/store/workspace'
import { DraftResumeSection } from '../draft-resume-section'

/**
 * MODEL-FLOW-010-T08, after the panel moved from the models list into Step 1.
 *
 * The move created two things nothing else covers. First, Resume can no longer
 * navigate: the wizard is already mounted on `/models/create`, so a
 * `?draftId=` push would change the URL while `useModelWizardMode`'s run-once
 * effect ignored it — a dead button that typechecks perfectly. Second,
 * resuming now clears a wizard the user may already have typed into, which on
 * the models list could never happen.
 */

const h = vi.hoisted(() => ({
  resume: vi.fn(),
  abandon: vi.fn(),
  refetch: vi.fn(),
  toastError: vi.fn(),
  drafts: [] as unknown[],
}))

vi.mock('@/hooks/model/use-model-draft-resume', () => ({
  useModelDraftResume: () => ({ resume: h.resume, resuming: false }),
}))

vi.mock('@/hooks/model/use-model-drafts', () => ({
  useModelDrafts: () => ({
    drafts: h.drafts,
    loading: false,
    error: null,
    refetch: h.refetch,
  }),
}))

vi.mock('@/services/model-draft', () => ({
  modelDraftService: { abandon: h.abandon },
}))

vi.mock('sonner', () => ({
  toast: { error: h.toastError, success: vi.fn(), warning: vi.fn() },
}))

const DRAFT = {
  id: 'draft-1',
  name: 'Boiler efficiency',
  workspaceId: 'ws-1',
  plantId: null,
  nodeId: null,
  datasetId: 'ds-1',
  targetY: 'TAG_A',
  algorithm: 'ridge',
  hyperparameters: {},
  splitRatio: 0.8,
  status: 'ACTIVE',
  currentRunId: null,
  savedModelId: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  updatedAt: '2026-08-21T11:00:00.000Z',
}

let store: ReturnType<typeof createStore>

beforeEach(() => {
  store = createStore()
  store.set(workspacesAtom, [
    { id: 'ws-1', name: 'Refinery' },
  ] as unknown as never)
  h.resume.mockReset().mockResolvedValue(true)
  h.abandon.mockReset().mockResolvedValue({ data: DRAFT })
  h.refetch.mockReset()
  h.toastError.mockReset()
  h.drafts = [DRAFT]
})

/** n drafts with distinct ids, for the visible-rows cap. */
function manyDrafts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...DRAFT,
    id: `draft-${i + 1}`,
    name: `Draft ${i + 1}`,
  }))
}

function renderSection(dirty: boolean) {
  return render(
    <Provider store={store}>
      <DraftResumeSection workspaceId="ws-1" dirty={dirty} />
    </Provider>,
  )
}

describe('DraftResumeSection (MODEL-FLOW-010-T08, in Step 1)', () => {
  it('hydrates in place on a clean wizard — no confirm, no navigation', async () => {
    renderSection(false)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    })

    expect(h.resume).toHaveBeenCalledWith('draft-1')
  })

  it('asks before replacing work the user has already entered', async () => {
    renderSection(true)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    })

    // Nothing restored yet — the dialog is the whole point.
    expect(h.resume).not.toHaveBeenCalled()
    expect(screen.getByText(/Resume this draft\?/i)).toBeInTheDocument()

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /replace and resume/i }),
      )
    })
    expect(h.resume).toHaveBeenCalledWith('draft-1')
  })

  it('keeps the current wizard when the confirm is dismissed', async () => {
    renderSection(true)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    })
    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /keep editing/i }),
      )
    })

    expect(h.resume).not.toHaveBeenCalled()
  })

  it('does not offer the draft that is already open', () => {
    // Otherwise Step 1 invites you to resume the thing you are looking at.
    store.set(mpServerDraftIdAtom, 'draft-1')
    renderSection(false)

    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
  })

  it('renders nothing at all when there are no drafts', () => {
    h.drafts = []
    const { container } = renderSection(false)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('DraftResumeSection — removing a draft', () => {
  it('confirms first, then abandons and refreshes the list', async () => {
    renderSection(false)

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /remove draft Boiler efficiency/i }),
      )
    })
    // One mis-click away from Resume, and there is no undo in the UI.
    expect(h.abandon).not.toHaveBeenCalled()

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    expect(h.abandon).toHaveBeenCalledWith('draft-1')
    expect(h.refetch).toHaveBeenCalled()
  })

  it('leaves the draft alone when the confirm is cancelled', async () => {
    renderSection(false)

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /remove draft Boiler efficiency/i }),
      )
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    })

    expect(h.abandon).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and says so when the remove fails', async () => {
    // Closing over a row that is still there would read as success.
    h.abandon.mockRejectedValue(new Error('500'))
    renderSection(false)

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /remove draft Boiler efficiency/i }),
      )
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    expect(h.toastError).toHaveBeenCalled()
    expect(h.refetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /^remove$/i }),
    ).toBeInTheDocument()
  })

  it('names the draft in the icon button label', () => {
    // Icon-only buttons: without this a screen reader hears N identical
    // "remove" controls with no way to tell them apart.
    h.drafts = manyDrafts(3)
    renderSection(false)

    expect(
      screen.getByRole('button', { name: /remove draft Draft 2/i }),
    ).toBeInTheDocument()
  })
})

describe('DraftResumeSection — bulk removes', () => {
  it('removes every listed draft on Remove all', async () => {
    h.drafts = manyDrafts(3)
    renderSection(false)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /remove all/i }))
    })
    expect(screen.getByText(/Remove 3 drafts\?/i)).toBeInTheDocument()

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    expect(h.abandon).toHaveBeenCalledTimes(3)
    expect(h.abandon.mock.calls.map(c => c[0]).sort()).toEqual([
      'draft-1',
      'draft-2',
      'draft-3',
    ])
    expect(h.refetch).toHaveBeenCalled()
  })

  it('removes only the ticked drafts on Remove selected', async () => {
    h.drafts = manyDrafts(3)
    renderSection(false)

    // No bulk control until something is ticked.
    expect(
      screen.queryByRole('button', { name: /remove selected/i }),
    ).toBeNull()

    await act(async () => {
      await userEvent.click(
        screen.getByRole('checkbox', { name: /select draft Draft 1/i }),
      )
      await userEvent.click(
        screen.getByRole('checkbox', { name: /select draft Draft 3/i }),
      )
    })

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /remove selected \(2\)/i }),
      )
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    // Draft 2 was never ticked and must survive.
    expect(h.abandon.mock.calls.map(c => c[0]).sort()).toEqual([
      'draft-1',
      'draft-3',
    ])
  })

  it('unticking removes a draft from the selection', async () => {
    h.drafts = manyDrafts(2)
    renderSection(false)

    const first = screen.getByRole('checkbox', {
      name: /select draft Draft 1/i,
    })
    await act(async () => {
      await userEvent.click(first)
    })
    expect(
      screen.getByRole('button', { name: /remove selected \(1\)/i }),
    ).toBeInTheDocument()

    await act(async () => {
      await userEvent.click(first)
    })
    expect(
      screen.queryByRole('button', { name: /remove selected/i }),
    ).toBeNull()
  })

  it('reports a partial failure instead of implying every draft went', async () => {
    // The trap: allSettled resolves happily even when half the calls rejected.
    h.drafts = manyDrafts(2)
    h.abandon
      .mockResolvedValueOnce({ data: DRAFT })
      .mockRejectedValueOnce(new Error('500'))
    renderSection(false)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /remove all/i }))
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    expect(h.toastError).toHaveBeenCalledWith(expect.stringContaining('1 of 2'))
    // The one that worked still has to disappear, so the list is re-read.
    expect(h.refetch).toHaveBeenCalled()
  })

  it('keeps the dialog open when every draft in the batch fails', async () => {
    h.drafts = manyDrafts(2)
    h.abandon.mockRejectedValue(new Error('500'))
    renderSection(false)

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /remove all/i }))
    })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    })

    expect(h.refetch).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /^remove$/i }),
    ).toBeInTheDocument()
  })
})

describe('DraftResumeSection — the visible-rows cap', () => {
  it('lists five drafts without a scroll container', () => {
    h.drafts = manyDrafts(5)
    const { container } = renderSection(false)

    expect(container.querySelector('[data-slot="scroll-area"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^resume$/i })).toHaveLength(5)
  })

  it('scrolls past five rather than pushing the rest of Step 1 down', () => {
    h.drafts = manyDrafts(6)
    const { container } = renderSection(false)

    expect(container.querySelector('[data-slot="scroll-area"]')).not.toBeNull()
    // Every draft is still reachable — capped in height, not truncated.
    expect(screen.getAllByRole('button', { name: /^resume$/i })).toHaveLength(6)
  })
})
