'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function NotFound() {
  useEffect(() => {
    sessionStorage.setItem('came-from-404', '1')
  }, [])
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center p-6">
      <h2 className="text-2xl font-semibold">404 — Page Not Found</h2>
      <p className="text-sm text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link
        href="/"
        className="rounded-md border px-4 py-2 text-sm hover:bg-accent transition-colors"
      >
        Go home
      </Link>
    </div>
  )
}
