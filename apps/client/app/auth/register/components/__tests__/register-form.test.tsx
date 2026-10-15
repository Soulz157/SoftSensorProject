import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RegisterForm } from '../register-form'

const createAccount = vi.fn()
vi.mock('@/hooks/auth/use-register', () => ({
  useRegister: () => ({ register: createAccount, isLoading: false }),
}))

async function fill(overrides: Partial<Record<string, string>> = {}) {
  const v = {
    'First name': 'Nok',
    'Last name': 'Srisuk',
    'Work email': 'nok@company.com',
    Company: 'MOC',
    Password: 'Refinery7',
    'Confirm password': 'Refinery7',
    ...overrides,
  }
  for (const [label, value] of Object.entries(v)) {
    if (value) await userEvent.type(screen.getByLabelText(label), value)
  }
}

describe('RegisterForm', () => {
  beforeEach(() => createAccount.mockReset())

  it('shows every field error inline, not just the confirm-password one', async () => {
    render(<RegisterForm />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )
    for (const msg of [
      'Enter your first name.',
      'Enter your last name.',
      'Enter a valid email address, like name@company.com.',
      'Enter your company name.',
      'Use at least 8 characters.',
      'Type your password again.',
    ]) {
      expect(await screen.findByText(msg)).toBeInTheDocument()
    }
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('blocks mismatched passwords with a fix-it message', async () => {
    render(<RegisterForm />)
    await fill({ 'Confirm password': 'Refinery8' })
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )
    expect(
      await screen.findByText(
        "Passwords don't match. Type the same password twice.",
      ),
    ).toBeInTheDocument()
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('creates the account with the same payload as before', async () => {
    render(<RegisterForm />)
    await fill()
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    )
    expect(createAccount).toHaveBeenCalledWith({
      firstName: 'Nok',
      lastName: 'Srisuk',
      email: 'nok@company.com',
      company: 'MOC',
      password: 'Refinery7',
      confirmPassword: 'Refinery7',
    })
  })

  it('has no dead Google or GitHub buttons', () => {
    render(<RegisterForm />)
    expect(screen.queryByRole('button', { name: /google|github/i })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Continue with Microsoft' }),
    ).toBeInTheDocument()
  })
})
