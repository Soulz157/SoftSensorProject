'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { resolveWorkspaceFilter } from '@/lib/workspace-list'

/**
 * The workspace filter on /models/views, kept in step with `?workspace=` —
 * the All Workspaces page's Models button links here with it.
 *
 * - Follows the URL: the App Router keeps the page mounted when only the
 *   search params change (e.g. the sidebar's plain `/models/views` link while
 *   on `?workspace=a`), so the param is re-read on every render and a change
 *   resets the selection — during render, no effect.
 * - Writes the URL: choosing a workspace replaces `?workspace=`, so a reload
 *   or Back restores what the user picked, not a stale id.
 * - An id the user does not have falls back to All (`resolveWorkspaceFilter`).
 *
 * Uses `useSearchParams`, so the calling page needs a Suspense boundary.
 */
export function useWorkspaceUrlFilter(workspaces: readonly { id: string }[]): {
  workspaceId: string
  selectWorkspace: (id: string) => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get('workspace') ?? ''

  const [selected, setSelected] = useState(requested)
  const [seenParam, setSeenParam] = useState(requested)
  let current = selected
  if (seenParam !== requested) {
    setSeenParam(requested)
    setSelected(requested)
    current = requested
  }

  const selectWorkspace = useCallback(
    (id: string) => {
      setSelected(id)
      const params = new URLSearchParams(searchParams.toString())
      if (id) params.set('workspace', id)
      else params.delete('workspace')
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return {
    workspaceId: resolveWorkspaceFilter(current, workspaces),
    selectWorkspace,
  }
}
