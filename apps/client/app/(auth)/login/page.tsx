import { AuthShell } from '@/components/auth/auth-shell'
import { TextLink } from '@/components/auth/text-link'
import { LoginForm } from './components/login-form'

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Use your work email, or your Microsoft account."
      footer={
        <>
          New to SoftSensor?{' '}
          <TextLink href="/register">Create an account</TextLink>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  )
}
