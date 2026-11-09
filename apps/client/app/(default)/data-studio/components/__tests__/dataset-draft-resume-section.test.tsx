import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResumableDatasetDraft } from '@/services/dataset-draft'
import { DatasetDraftResumeSection } from '../dataset-draft-resume-section'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const hook = vi.hoisted(() => ({
  state: {
    drafts: [] as ResumableDatasetDraft[],
    loading: false,
    discard: vi.fn(),
  },
}))
vi.mock('@/hooks/dataset/use-resumable-dataset-drafts', () => ({
  useResumableDatasetDrafts: () => hook.state,
}))

const DRAFT: ResumableDatasetDraft = {
  id: 'draft-1',
  name: 'Boiler',
  workspaceId: 'ws-1',
  status: 'ACTIVE',
  updatedAt: '2026-10-12T00:00:00.000Z',
  currentStep: 4,
}

describe('DatasetDraftResumeSection (DS-LAKE-037)', () => {
  beforeEach(() => {
    push.mockClear()
    hook.state.discard = vi.fn().mockResolvedValue(undefined)
    hook.state.loading = false
    hook.state.drafts = [DRAFT]
  })

  it('renders nothing while loading or with no drafts', () => {
    hook.state.drafts = []
    const { container } = render(
      <DatasetDraftResumeSection getWorkspaceName={() => 'Plant A'} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('resumes into the wizard URL carrying the draft id', async () => {
    render(<DatasetDraftResumeSection getWorkspaceName={() => 'Plant A'} />)

    expect(screen.getByText('Boiler')).toBeInTheDocument()
    expect(screen.getByText(/Plant A · Step 4 of 6/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(push).toHaveBeenCalledWith('/data-studio/create?draftId=draft-1')
  })

  it('says the data will be re-fetched for a draft the sweep abandoned', () => {
    hook.state.drafts = [{ ...DRAFT, status: 'ABANDONED' }]
    render(<DatasetDraftResumeSection getWorkspaceName={() => 'Plant A'} />)
    expect(screen.getByText(/data will be fetched again/)).toBeInTheDocument()
  })

  it('discards only after the confirm', async () => {
    render(<DatasetDraftResumeSection getWorkspaceName={() => 'Plant A'} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Discard Boiler' }),
    )
    expect(hook.state.discard).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(hook.state.discard).toHaveBeenCalledWith('draft-1'),
    )
  })
})
