import { AppLayout } from '@/components/app-layout'
import { AuthPanel } from '@/components/auth/auth-panel'

export default function LandingPage() {
  return (
    <AppLayout>
      <div className="flex h-full">
        <div className="relative z-10 flex w-full items-center justify-center p-8">
          <AuthPanel />
        </div>
      </div>
    </AppLayout>
  )
}
