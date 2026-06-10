import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useProfile } from '@/hooks/user/use-profile'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'

export function useNavbar() {
  const { data: session } = useSession()
  const { profile, loading, refetch } = useProfile()
  const { workspaces } = useWorkspaces()

  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )
  const isHealthy = alarmCount === 0

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refetch?.()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refetch])

  return {
    session,
    profile,
    loading,
    alarmCount,
    isHealthy,
  }
}
