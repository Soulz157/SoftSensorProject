'use client'
import { ArrowLeft, Box } from 'lucide-react'
import Link from 'next/link'

export default function ErrorModelPage() {
  return (
    <div className="flex-1 overflow-auto p-6 md:p-8">
      <Link
        href="/models/views"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Models
      </Link>
      <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
        <Box className="h-10 w-10 opacity-30" />
        <p className="text-base font-medium">Model not found</p>
      </div>
    </div>
  )
}
