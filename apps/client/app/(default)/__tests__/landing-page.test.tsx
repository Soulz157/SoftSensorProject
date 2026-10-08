import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const session = vi.fn()
const workspacesHook = vi.fn()
const replace = vi.fn()

vi.mock('next-auth/react', () => ({ useSession: () => session() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/hooks/workspace/use-workspaces', () => ({
  useWorkspaces: () => workspacesHook(),
}))
vi.mock('@/components/landing/landing-hero', () => ({
  LandingHero: () => <div>landing hero</div>,
}))
vi.mock('@/components/auth/create-workspace-form', () => ({
  CreateWorkspaceForm: () => <div>create form</div>,
}))

import LandingPage from '../page'

const state = (
  status: 'loading' | 'authenticated' | 'unauthenticated',
  ws: { workspaces: { id: string }[]; loading: boolean },
) => {
  session.mockReturnValue({ status })
  workspacesHook.mockReturnValue(ws)
}

describe('/ (LandingPage)', () => {
  beforeEach(() => replace.mockReset())

  it('session loading: the landing skeleton, nothing else', () => {
    state('loading', { workspaces: [], loading: true })
    const { container } = render(<LandingPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByText('landing hero')).toBeNull()
    expect(screen.queryByText('create form')).toBeNull()
    // The old bare spinner is gone.
    expect(screen.queryByLabelText('Loading')).toBeNull()
  })

  it('guest: the landing hero', () => {
    state('unauthenticated', { workspaces: [], loading: false })
    render(<LandingPage />)
    expect(screen.getByText('landing hero')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('signed in, workspaces still loading: form skeleton, never the form', () => {
    state('authenticated', { workspaces: [], loading: true })
    render(<LandingPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('create form')).toBeNull()
  })

  it('signed in with workspaces: skeleton while redirecting to /overview', () => {
    state('authenticated', { workspaces: [{ id: 'w1' }], loading: false })
    render(<LandingPage />)
    expect(screen.queryByText('create form')).toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith('/overview')
  })

  it('signed in with no workspaces: the create form', () => {
    state('authenticated', { workspaces: [], loading: false })
    render(<LandingPage />)
    expect(screen.getByText('create form')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})
