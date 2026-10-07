import Link from 'next/link'
import type { ReactNode } from 'react'

/** Inline link inside auth footers ("New to SoftSensor? Create an account"). */
export function TextLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  )
}
