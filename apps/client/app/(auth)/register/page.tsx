import { AuthShell } from '@/components/auth/auth-shell'
import { TextLink } from '@/components/auth/text-link'
import { RegisterForm } from './components/register-form'

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      description="You can join or create a workspace after this."
      footer={
        <>
          Already have an account? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  )
}
