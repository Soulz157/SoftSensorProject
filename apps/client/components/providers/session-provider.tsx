'use client'

import { Provider as JotaiProvider } from 'jotai'
import { ThemeProvider } from './theme-provider'
import { TooltipProvider } from '../ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider } from 'next-auth/react'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <SessionProvider>
        <JotaiProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </JotaiProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
