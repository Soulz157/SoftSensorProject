'use client'

import { SessionProvider } from 'next-auth/react'
import { Provider as JotaiProvider } from 'jotai'

export function SessionProviders({ children }: { children: React.ReactNode }) {
  return (
    <JotaiProvider>
      <SessionProvider>{children}</SessionProvider>
    </JotaiProvider>
  )
}
