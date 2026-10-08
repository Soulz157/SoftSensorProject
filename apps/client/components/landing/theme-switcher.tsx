'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Same three choices, icons and order as Settings → Appearance. */
const OPTIONS = [
  { id: 'light', label: 'Light theme', Icon: Sun },
  { id: 'dark', label: 'Dark theme', Icon: Moon },
  { id: 'system', label: 'Match system', Icon: Monitor },
] as const

/**
 * Compact light / dark / system switch for pages outside the app shell
 * (the signed-out landing). The theme is only known in the browser, so
 * nothing reads as selected until after mount — the server and first client
 * render agree, which keeps hydration clean.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  const current = mounted ? (theme ?? 'system') : null

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('flex items-center rounded-md bg-muted p-0.5', className)}
    >
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = current === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={cn(
              'flex size-7 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
              active && 'bg-background text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
