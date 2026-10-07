'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'

/** The one configured OAuth provider (Microsoft Entra ID). The mark is
 *  drawn in `currentColor` so the button stays within the token palette. */
export function MicrosoftSignIn({ disabled }: { disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-9 w-full gap-2"
      disabled={disabled}
      onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/overview' })}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-4"
        aria-hidden
        fill="currentColor"
      >
        <rect x="1" y="1" width="6.5" height="6.5" />
        <rect x="8.5" y="1" width="6.5" height="6.5" opacity="0.7" />
        <rect x="1" y="8.5" width="6.5" height="6.5" opacity="0.7" />
        <rect x="8.5" y="8.5" width="6.5" height="6.5" opacity="0.5" />
      </svg>
      Continue with Microsoft
    </Button>
  )
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
