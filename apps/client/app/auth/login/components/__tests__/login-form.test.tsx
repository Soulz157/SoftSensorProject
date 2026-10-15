import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { signIn } from 'next-auth/react'
import { vi } from 'vitest'
import { LoginForm } from '../login-form'

const login = vi.fn()
vi.mock('@/hooks/auth/use-auth', () => ({ useAuth: () => ({ login }) }))

describe('LoginForm', () => {
  beforeEach(() => {
    login.mockReset()
    vi.mocked(signIn).mockReset()
  })

  it('shows inline errors and does not submit an empty form', async () => {
    render(<LoginForm />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByText(
        'Enter a valid email address, like name@company.com.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(login).not.toHaveBeenCalled()
  })

  it('submits email and password to login', async () => {
    login.mockResolvedValue(undefined)
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'nok@company.com')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login.mock.calls[0]?.[0]).toEqual({
      email: 'nok@company.com',
      password: 'secret',
    })
  })

  it('shows the submitting state only while the sign-in call is running', async () => {
    let resolve: () => void = () => {}
    login.mockImplementation(() => new Promise<void>(r => (resolve = r)))
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'nok@company.com')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(
      await screen.findByRole('button', { name: /Signing in/ }),
    ).toBeDisabled()
    resolve()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('offers Microsoft sign-in (the configured provider) and no Google button', async () => {
    render(<LoginForm />)
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue with Microsoft' }),
    )
    expect(signIn).toHaveBeenCalledWith('microsoft-entra-id', {
      callbackUrl: '/overview',
    })
  })
})
