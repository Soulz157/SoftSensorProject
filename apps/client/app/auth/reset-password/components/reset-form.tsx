'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormField } from '@/components/auth/form-field'
import { resetRequestSchema, type ResetRequestValues } from '@/lib/auth-schemas'

export function ResetPasswordForm({
  defaultEmail,
  isLoading,
  onSubmit,
}: {
  defaultEmail: string
  isLoading: boolean
  onSubmit: (email: string) => Promise<void>
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetRequestValues>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: defaultEmail },
  })

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit(v => onSubmit(v.email))}
      noValidate
    >
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
      <Button type="submit" className="h-9 w-full" disabled={isLoading}>
        {isLoading && <Spinner />}
        {isLoading ? 'Sending link' : 'Send reset link'}
      </Button>
    </form>
  )
}
