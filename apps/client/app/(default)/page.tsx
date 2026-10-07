'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'
import { LandingHero } from '@/components/landing/landing-hero'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { Spinner } from '@/components/ui/spinner'

export default function LandingPage() {
  const { status } = useSession()

  const { workspaces } = useWorkspaces({
    enabled: status === 'authenticated',
  })

  const router = useRouter()

  // const fetchMicrosoftProfile = async () => {
  //   const res = await fetch('https://graph.microsoft.com/v1.0/me', {
  //     headers: { Authorization: `Bearer ${session?.user?.accessToken}` },
  //   })
  //   const data = await res.json()
  //   console.log(data)
  // }

  useEffect(() => {
    if (status === 'authenticated' && workspaces.length > 0) {
      router.replace('/overview')
    }
  }, [status, workspaces.length, router])

  if (status === 'loading') {
    return <Spinner />
  }

  // Signed out: the full-screen landing (AppLayout drops its shell on `/`
  // for guests). Direction C chosen 2026-10-07; the A/C preview stays at
  // /design-preview/landing.
  if (status !== 'authenticated') {
    return <LandingHero layout="tags" />
  }

  return (
    <div className="flex h-full font-sans">
      <div className="relative z-10 flex w-full items-center justify-center p-8 font-sans">
        <CreateWorkspaceForm />
      </div>
    </div>
  )
}
