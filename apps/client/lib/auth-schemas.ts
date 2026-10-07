import * as z from 'zod'
import {
  REGISTER_RULE_IDS,
  rulesFor,
  STRICT_RULE_IDS,
  type PasswordRuleId,
} from './password-rules'

/**
 * Form rules for the auth pages, in one pure module. Password rules come
 * from `password-rules.ts`, so the strength checklist and validation can
 * never disagree. Messages say what is wrong and how to fix it.
 */

function passwordWith(ids: readonly PasswordRuleId[]) {
  return rulesFor(ids).reduce(
    (schema, rule) => schema.refine(rule.test, rule.message),
    z.string(),
  )
}

const email = z.email('Enter a valid email address, like name@company.com.')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter your first name.'),
    lastName: z.string().trim().min(1, 'Enter your last name.'),
    email,
    company: z.string().trim().min(1, 'Enter your company name.'),
    password: passwordWith(REGISTER_RULE_IDS),
    confirmPassword: z.string().min(1, 'Type your password again.'),
  })
  .refine(d => d.password === d.confirmPassword, {
    message: "Passwords don't match. Type the same password twice.",
    path: ['confirmPassword'],
  })
export type RegisterValues = z.infer<typeof registerSchema>

export const resetRequestSchema = z.object({ email })
export type ResetRequestValues = z.infer<typeof resetRequestSchema>

export const newPasswordSchema = z
  .object({
    password: passwordWith(STRICT_RULE_IDS),
    confirmPassword: z.string().min(1, 'Type your new password again.'),
  })
  .refine(d => d.password === d.confirmPassword, {
    message: "Passwords don't match. Type the same password twice.",
    path: ['confirmPassword'],
  })
export type NewPasswordValues = z.infer<typeof newPasswordSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordWith(STRICT_RULE_IDS),
    confirmPassword: z.string().min(1, 'Type your new password again.'),
  })
  .refine(d => d.newPassword === d.confirmPassword, {
    message: "Passwords don't match. Type the same password twice.",
    path: ['confirmPassword'],
  })
  .refine(d => d.currentPassword !== d.newPassword, {
    message: 'Choose a password different from your current one.',
    path: ['newPassword'],
  })
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>
