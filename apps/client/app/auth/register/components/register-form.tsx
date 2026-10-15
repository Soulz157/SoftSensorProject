'use client'

import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormField } from '@/components/auth/form-field'
import { PasswordField } from '@/components/auth/password-field'
import { PasswordStrength } from '@/components/auth/password-strength'
import { MicrosoftSignIn, OrDivider } from '@/components/auth/microsoft-sign-in'
import { useRegister } from '@/hooks/auth/use-register'
import { registerSchema, type RegisterValues } from '@/lib/auth-schemas'
import { REGISTER_RULE_IDS } from '@/lib/password-rules'

type TextFieldName = 'firstName' | 'lastName' | 'email' | 'company'

export function RegisterForm() {
  const { register: createAccount, isLoading } = useRegister()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      company: '',
      password: '',
      confirmPassword: '',
    },
  })
  const password = useWatch({ control, name: 'password' })

  const textField = (
    name: TextFieldName,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <FormField id={name} label={label} error={errors[name]?.message}>
      <Input
        id={name}
        className="h-9"
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        {...props}
        {...register(name)}
      />
    </FormField>
  )

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(values => createAccount(values))}
      noValidate
    >
      <div className="grid grid-cols-2 gap-3">
        {textField('firstName', 'First name', { autoComplete: 'given-name' })}
        {textField('lastName', 'Last name', { autoComplete: 'family-name' })}
      </div>
      {textField('email', 'Work email', {
        type: 'email',
        autoComplete: 'email',
        placeholder: 'name@company.com',
      })}
      {textField('company', 'Company', { autoComplete: 'organization' })}
      <FormField
        id="password"
        label="Password"
        error={errors.password?.message}
      >
        <PasswordField
          id="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          aria-describedby={
            errors.password ? 'password-error password-rules' : 'password-rules'
          }
          {...register('password')}
        />
      </FormField>
      <PasswordStrength
        id="password-rules"
        password={password}
        ruleIds={REGISTER_RULE_IDS}
      />
      <FormField
        id="confirmPassword"
        label="Confirm password"
        error={errors.confirmPassword?.message}
      >
        <PasswordField
          id="confirmPassword"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          aria-describedby={
            errors.confirmPassword ? 'confirmPassword-error' : undefined
          }
          {...register('confirmPassword')}
        />
      </FormField>
      <Button type="submit" className="h-9 w-full" disabled={isLoading}>
        {isLoading && <Spinner />}
        {isLoading ? 'Creating account' : 'Create account'}
      </Button>
      <OrDivider />
      <MicrosoftSignIn disabled={isLoading} />
    </form>
  )
}
