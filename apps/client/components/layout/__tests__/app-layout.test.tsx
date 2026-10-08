import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const session = vi.fn()
const pathname = vi.fn()

vi.mock('next-auth/react', () => ({ useSession: () => session() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => pathname(),
}))
vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <div>app sidebar</div>,
}))
vi.mock('@/components/layout/navbar', () => ({
  Navbar: () => <div>app navbar</div>,
}))
vi.mock('@/components/create-workspace', () => ({
  CreateWorkspaceDialog: () => null,
}))

import { AppLayout } from '../app-layout'

const at = (path: string, status: string) => {
  pathname.mockReturnValue(path)
  session.mockReturnValue({ status })
  render(
    <AppLayout>
      <div>page</div>
    </AppLayout>,
  )
}

describe('AppLayout on /', () => {
  it('renders no shell while the session is loading (no flash for guests)', () => {
    at('/', 'loading')
    expect(screen.getByText('page')).toBeInTheDocument()
    expect(screen.queryByText('app sidebar')).toBeNull()
    expect(screen.queryByText('app navbar')).toBeNull()
  })

  it('renders no shell for a guest', () => {
    at('/', 'unauthenticated')
    expect(screen.queryByText('app sidebar')).toBeNull()
  })

  it('renders the shell once signed in', () => {
    at('/', 'authenticated')
    expect(screen.getByText('app sidebar')).toBeInTheDocument()
  })

  it('keeps the shell on other routes while loading', () => {
    at('/overview', 'loading')
    expect(screen.getByText('app sidebar')).toBeInTheDocument()
  })
})
