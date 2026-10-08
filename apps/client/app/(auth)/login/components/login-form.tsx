'use client'

import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormField } from '@/components/auth/form-field'
import { PasswordField } from '@/components/auth/password-field'
import { MicrosoftSignIn, OrDivider } from '@/components/auth/microsoft-sign-in'
import { useAuth } from '@/hooks/auth/use-auth'
import { loginSchema, type LoginValues } from '@/lib/auth-schemas'

export function LoginForm() {
  const { login } = useAuth()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <form className="space-y-4" onSubmit={handleSubmit(login)} noValidate>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          className="h-9"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
      </FormField>
      <FormField
        id="password"
        label="Password"
        error={errors.password?.message}
        aside={
          <Link
            href="/reset-password"
            className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Forgot password?
          </Link>
        }
      >
        <PasswordField
          id="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
      </FormField>
      <Button type="submit" className="h-9 w-full" disabled={isSubmitting}>
        {isSubmitting && <Spinner />}
        {isSubmitting ? 'Signing in' : 'Sign in'}
      </Button>
      <OrDivider />
      <MicrosoftSignIn disabled={isSubmitting} />
    </form>
  )
}
