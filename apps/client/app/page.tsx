'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/app-layout'
import { CreateWorkspaceForm } from '@/components/auth'
import { AuthPanel } from '@/components/auth/auth-panel'
import { useSession } from 'next-auth/react'
import { useWorkspaceStore } from '@/store/auth-store'

export default function LandingPage() {
  const { data: session, status } = useSession()
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated' && workspaces.length > 0) {
      router.replace('/dashboard')
    }
  }, [status, workspaces.length, router])

  if (status === 'loading') {
    return null
  }

  return (
    <AppLayout>
      <div className="flex h-full">
        <div className="relative z-10 flex w-full items-center justify-center p-8">
          {session?.user ? <CreateWorkspaceForm /> : <AuthPanel />}
        </div>
      </div>
    </AppLayout>
  )
}
