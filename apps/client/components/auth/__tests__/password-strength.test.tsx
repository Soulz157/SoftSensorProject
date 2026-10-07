import { render, screen } from '@testing-library/react'
import { PasswordStrength } from '../password-strength'
import { REGISTER_RULE_IDS } from '@/lib/password-rules'

describe('PasswordStrength', () => {
  it('announces how many rules are met', () => {
    render(<PasswordStrength password="Plant2026" />)
    expect(screen.getByText('3 of 4 password rules met')).toBeInTheDocument()
    expect(screen.getByText('Symbol').textContent).toContain('(not met)')
  })

  it('shows only the rules it is given', () => {
    render(<PasswordStrength password="" ruleIds={REGISTER_RULE_IDS} />)
    expect(screen.queryByText('Symbol')).toBeNull()
    expect(screen.getByText('0 of 3 password rules met')).toBeInTheDocument()
  })
})
