import { describe, it, expect, vi } from 'vitest'

const redirect = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }))

import AdminPage from '../page'

describe('/admin', () => {
  it('redirects to the merged admin home', () => {
    AdminPage()
    expect(redirect).toHaveBeenCalledWith('/admin/dashboard')
  })
})
