'use client'
import { useCallback, useEffect, useState } from 'react'
import { UserProfile } from '@/types'
import { profileService } from '@/services/profile'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'

export function useProfile() {
  const { status } = useSession()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchProfile = useCallback(async () => {
    setLoading(true)

    try {
      const data = await profileService.getProfile()
      setProfile(data.data)
    } catch (err) {
      if (err instanceof Error) {
        toast.error('Failed to load profile')
      } else {
        toast.error('An unknown error occurred')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'loading') {
      return
    }
    if (status !== 'authenticated') {
      setLoading(false)
      setProfile(null)
    } else {
      fetchProfile()
    }
  }, [fetchProfile, status])

  return { profile, loading, refetch: fetchProfile }
}
