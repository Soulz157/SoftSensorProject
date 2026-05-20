'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/app-layout'
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'
import { AuthPanel } from '@/components/auth/auth-panel'
import { useSession } from 'next-auth/react'
import { useAtomValue } from 'jotai'
import { workspacesAtom } from '@/store/workspace'

export default function LandingPage() {
  const { data: session, status } = useSession()
  const workspaces = useAtomValue(workspacesAtom)
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
    <div className="flex h-full font-sans">
      <div className="relative z-10 flex w-full items-center justify-center p-8 font-sans">
        {session?.user ? <CreateWorkspaceForm /> : <AuthPanel />}
      </div>
    </div>
  )
}
