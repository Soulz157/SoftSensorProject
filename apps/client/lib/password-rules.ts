/**
 * The password rules the auth pages check, in one place. Register asks for
 * the first three (unchanged from before); reset and change-password ask for
 * all four. Zod schemas and the strength meter read the SAME list, so the
 * meter can never show a rule the form does not enforce.
 */
export type PasswordRuleId = 'length' | 'upper' | 'number' | 'symbol'

export interface PasswordRule {
  id: PasswordRuleId
  label: string
  /** Inline error sentence when the rule fails. */
  message: string
  test: (password: string) => boolean
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: '8+ characters',
    message: 'Use at least 8 characters.',
    test: p => p.length >= 8,
  },
  {
    id: 'upper',
    label: 'Uppercase letter',
    message: 'Add an uppercase letter.',
    test: p => /[A-Z]/.test(p),
  },
  {
    id: 'number',
    label: 'Number',
    message: 'Add a number.',
    test: p => /[0-9]/.test(p),
  },
  {
    id: 'symbol',
    label: 'Symbol',
    message: 'Add a symbol, such as ! or #.',
    test: p => /[^A-Za-z0-9]/.test(p),
  },
]

export const REGISTER_RULE_IDS: readonly PasswordRuleId[] = [
  'length',
  'upper',
  'number',
]
export const STRICT_RULE_IDS: readonly PasswordRuleId[] = [
  'length',
  'upper',
  'number',
  'symbol',
]

export function rulesFor(ids: readonly PasswordRuleId[]): PasswordRule[] {
  return PASSWORD_RULES.filter(r => ids.includes(r.id))
}

export interface PasswordCheck {
  id: PasswordRuleId
  label: string
  met: boolean
}

export function checkPassword(
  password: string,
  ids: readonly PasswordRuleId[] = STRICT_RULE_IDS,
): PasswordCheck[] {
  return rulesFor(ids).map(r => ({
    id: r.id,
    label: r.label,
    met: r.test(password),
  }))
}

/** First failing rule's message, or null when every rule passes. */
export function firstPasswordProblem(
  password: string,
  ids: readonly PasswordRuleId[] = STRICT_RULE_IDS,
): string | null {
  const failed = rulesFor(ids).find(r => !r.test(password))
  return failed ? failed.message : null
}
