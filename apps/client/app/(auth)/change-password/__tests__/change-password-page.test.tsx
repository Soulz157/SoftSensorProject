import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import ChangePasswordPage from '../page'

const changePassword = vi.fn()
vi.mock('@/hooks/auth/use-change-password', () => ({
  useChangePassword: () => ({
    changePassword,
    isLoading: false,
    isSuccess: false,
    router: { push: vi.fn() },
  }),
}))

beforeAll(() => {
  // The trend panel reads prefers-reduced-motion; jsdom has no matchMedia.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

describe('ChangePasswordPage', () => {
  beforeEach(() => changePassword.mockReset())

  it('refuses a new password equal to the current one', async () => {
    render(<ChangePasswordPage />)
    await userEvent.type(
      screen.getByLabelText('Current password'),
      'Plant2026!',
    )
    await userEvent.type(screen.getByLabelText('New password'), 'Plant2026!')
    await userEvent.type(
      screen.getByLabelText('Confirm new password'),
      'Plant2026!',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Update password' }),
    )
    expect(
      await screen.findByText(
        'Choose a password different from your current one.',
      ),
    ).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('names the missing rule inline', async () => {
    render(<ChangePasswordPage />)
    await userEvent.type(screen.getByLabelText('Current password'), 'old')
    await userEvent.type(screen.getByLabelText('New password'), 'Plant2026')
    await userEvent.type(
      screen.getByLabelText('Confirm new password'),
      'Plant2026',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Update password' }),
    )
    expect(
      await screen.findByText('Add a symbol, such as ! or #.'),
    ).toBeInTheDocument()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('submits a valid change', async () => {
    render(<ChangePasswordPage />)
    await userEvent.type(
      screen.getByLabelText('Current password'),
      'Plant2025!',
    )
    await userEvent.type(screen.getByLabelText('New password'), 'Plant2026!')
    await userEvent.type(
      screen.getByLabelText('Confirm new password'),
      'Plant2026!',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Update password' }),
    )
    expect(changePassword.mock.calls[0]?.[0]).toEqual({
      currentPassword: 'Plant2025!',
      newPassword: 'Plant2026!',
      confirmPassword: 'Plant2026!',
    })
  })
})
