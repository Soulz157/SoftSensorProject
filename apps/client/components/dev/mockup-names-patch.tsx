'use client'

import { useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
import { modelsRefreshAtom, workspacesAtom } from '@/store/workspace'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import {
  findLeaks,
  invertTokens,
  remapNames,
  tokenReplacer,
  type MockupNameMap,
} from '@/lib/mockup-names'
import { DOCUMENT_MOCKUP } from './mockup-map'

/** sessionStorage flag, set from `/dev/mockup-names`. Per browser tab. */
export const MOCKUP_NAMES_FLAG = 'mockup-names'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export function mockupNamesEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(MOCKUP_NAMES_FLAG) === 'on'
  } catch {
    return false
  }
}

/**
 * Wraps `window.fetch` so API JSON (and the NextAuth session) comes back
 * with mock names, and requests carrying a mock name go out with the real
 * one. Returns the uninstaller.
 */
function installFetchPatch(map: MockupNameMap): () => void {
  const original = window.fetch
  const toReal = tokenReplacer(invertTokens(map.tokens))

  const patched: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const isSession = url.includes('/api/auth/session')
    const isApi = API_BASE !== '' && url.startsWith(API_BASE)
    if (!isApi && !isSession) return original(input, init)

    const sentInput =
      isApi && typeof input === 'string' ? toReal(input) : input
    const sentInit =
      isApi && init && typeof init.body === 'string'
        ? { ...init, body: toReal(init.body) }
        : init
    const res = await original(sentInput, sentInit)
    if (!(res.headers.get('content-type') ?? '').includes('json')) return res

    const text = await res.text()
    let body: string
    try {
      body = JSON.stringify(remapNames(JSON.parse(text) as unknown, map))
    } catch {
      body = text
    }
    const leaks = findLeaks(body, map.leakTokens)
    if (leaks.length > 0) {
      console.warn('[mockup-names] real names left in', url, leaks)
    }
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }

  window.fetch = patched
  return () => {
    if (window.fetch === patched) window.fetch = original
  }
}

let installed = false

/**
 * Dev-only document mockup mode. When the tab's flag is on, every page
 * renders unchanged but with the agreed mock names (`mockup-map.ts`) in
 * place of plant identity. Mounted first in the app shell so the patch is
 * in place before any child effect fetches. Renders nothing.
 */
export function MockupNamesPatch() {
  const setWorkspaces = useSetAtom(workspacesAtom)
  const bumpModels = useSetAtom(modelsRefreshAtom)
  const [enabled] = useState(() => {
    const on = mockupNamesEnabled()
    if (on && !installed) {
      installed = true
      clearChartRequestCache()
      installFetchPatch(DOCUMENT_MOCKUP)
    }
    return on
  })

  useEffect(() => {
    if (!enabled) return
    // The workspace list is persisted in localStorage, so its first paint
    // would still carry real names; refetches go through the patch.
    setWorkspaces(prev => remapNames(prev, DOCUMENT_MOCKUP))
    bumpModels(n => n + 1)
  }, [enabled, setWorkspaces, bumpModels])

  return null
}
