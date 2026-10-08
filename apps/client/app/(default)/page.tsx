'use client'

export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'
import { CreateWorkspaceFormSkeleton } from '@/components/auth/create-workspace-form-skeleton'
import { LandingHero } from '@/components/landing/landing-hero'
import { LandingSkeleton } from '@/components/landing/landing-skeleton'
import { useSession } from 'next-auth/react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'

export default function LandingPage() {
  const { status } = useSession()

  const { workspaces, loading } = useWorkspaces({
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

  // Session unknown: almost always a guest on `/`, so hold the landing
  // page's shape (AppLayout shows no shell until the session is known).
  if (status === 'loading') {
    return <LandingSkeleton />
  }

  // Signed out: the full-screen landing (AppLayout drops its shell on `/`
  // for guests). Direction C chosen 2026-10-07; live sensor-vs-lab section
  // below it chosen 2026-10-08.
  if (status !== 'authenticated') {
    return <LandingHero layout="tags" kpis />
  }

  // Signed in: the create form is only for someone with NO workspaces. Until
  // that is known — or while the effect above redirects — show its skeleton,
  // never the real form.
  const waiting = loading || workspaces.length > 0

  return (
    <div className="flex h-full font-sans">
      <div className="relative z-10 flex w-full items-center justify-center p-8 font-sans">
        {waiting ? <CreateWorkspaceFormSkeleton /> : <CreateWorkspaceForm />}
      </div>
    </div>
  )
}
