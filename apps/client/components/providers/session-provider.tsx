'use client'

import { Provider as JotaiProvider } from 'jotai'
import { ThemeProvider } from './theme-provider'
import { TooltipProvider } from '../ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { NOTIFICATION_TOASTER_ID } from '@/lib/notification-toast'
import { SessionProvider } from 'next-auth/react'

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <SessionProvider>
        <JotaiProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-center" />
            {/* New-notification toasts only (NOTIFICATION_TOASTER_ID): top
                right, under the 64px navbar so the bell stays visible. */}
            <Toaster
              id={NOTIFICATION_TOASTER_ID}
              position="top-right"
              offset={{ top: 72, right: 16 }}
              mobileOffset={{ top: 72, right: 16 }}
            />
          </TooltipProvider>
        </JotaiProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
