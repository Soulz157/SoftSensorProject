import { AppLayout } from '@/components/app-layout'
import { AuthPanel } from '@/components/auth/auth-panel'
import { DashboardContent } from '@/components/dashboard-content'

export default function LandingPage() {
  return (
    <AppLayout>
      <DashboardContent />
    </AppLayout>
  )
}
