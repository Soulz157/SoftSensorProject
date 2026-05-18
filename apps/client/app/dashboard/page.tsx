import { AppLayout } from '@/components/app-layout'
import { AuthPanel } from '@/components/auth/auth-panel'
import { DashboardContent } from '@/components/dashboard-content'
import { LandingHero } from '@/components/landing/landing-hero'

export default function LandingPage() {
  return (
    <AppLayout>
      <DashboardContent />
    </AppLayout>
  )
}
