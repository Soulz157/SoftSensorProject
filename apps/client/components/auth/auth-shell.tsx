import type { ReactNode } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/components/brand/brand-mark'
import { cn } from '@/lib/utils'
import { ThemeSwitcher } from '@/components/landing/theme-switcher'
import { SignalTrace } from './signal-trace'

export type AuthLayout = 'split' | 'card'

/**
 * Which layout every auth screen uses. User's call 2026-10-07: back to the
 * trend panel (`split`, direction A). The centred card with the line through
 * its top border (`card`, direction B) is kept — change this one word to
 * switch every auth page.
 */
export const AUTH_LAYOUT: AuthLayout = 'split'

/**
 * One shell for every auth screen. The logo is the way home.
 * - `split`: a live trend panel on the left (hover reads the value under the
 *   cursor), the form on the right. Below `md` the panel becomes a short
 *   strip above the form.
 * - `card`: a centred card; the signal line runs edge to edge through its
 *   top border and bends toward the pointer.
 */
export function AuthShell({
  title,
  description,
  footer,
  children,
  layout = AUTH_LAYOUT,
}: {
  title: string
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  layout?: AuthLayout
}) {
  const homeLink = (className: string) => (
    <Link
      href="/"
      aria-label="SoftSensor home"
      className={cn(
        'rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <BrandMark />
    </Link>
  )

  const heading = (
    <header className="space-y-1.5">
      <h1 className="text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-semibold tracking-[-0.02em] text-balance">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  )

  if (layout === 'split') {
    return (
      <div className="relative grid min-h-svh grid-rows-[auto_1fr] bg-background md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:grid-rows-1">
        {/* Page top-right: in the trend strip beside the logo on phones,
            over the form column on md+. */}
        <ThemeSwitcher className="absolute top-4 right-4 z-20 md:top-6 md:right-8" />
        <aside className="relative h-28 overflow-hidden border-b border-border bg-card md:h-auto md:border-r md:border-b-0">
          {homeLink('absolute top-5 left-6 z-10 md:top-8 md:left-10')}
          <SignalTrace
            variant="chart"
            actual
            className="absolute inset-x-0 top-12 bottom-0 md:inset-0"
          />
        </aside>
        <main className="flex items-start justify-center px-4 pt-10 pb-12 sm:px-8 md:items-center md:py-12">
          <div className="w-full max-w-sm space-y-6">
            {heading}
            {children}
            {footer && (
              <div className="text-sm text-muted-foreground">{footer}</div>
            )}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-x-clip bg-background px-4 py-16">
      <ThemeSwitcher className="absolute top-4 right-4 z-10 md:top-6 md:right-8" />
      <div className="relative w-full max-w-sm">
        <SignalTrace
          variant="line"
          actual
          className="pointer-events-none absolute top-0 left-1/2 h-56 w-screen -translate-x-1/2 -translate-y-1/2"
        />
        <section className="relative space-y-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8">
          {homeLink('inline-flex')}
          {heading}
          {children}
        </section>
        {footer && (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
