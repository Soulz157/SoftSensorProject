'use client'

// TEMPORARY design preview (landing redesign, Phase A). Delete once a
// direction is chosen.

import { useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import {
  LandingHero,
  type HeroSize,
  type LandingLayout,
} from '@/components/landing/landing-hero'
import { cn } from '@/lib/utils'

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md bg-muted p-0.5">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-2 py-1 text-xs whitespace-nowrap transition-colors',
            value === o.id
              ? 'bg-background font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function LandingDesignPreview() {
  const [layout, setLayout] = useState<LandingLayout>('line')
  const [size, setSize] = useState<HeroSize>('large')
  const [aura, setAura] = useState<'on' | 'off'>('on')
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  return (
    <>
      <div className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg bg-popover p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.08)] ring-1 ring-foreground/10 dark:shadow-[0_4px_24px_rgba(0,0,0,0.32)]">
        <Seg
          value={layout}
          options={[
            { id: 'line', label: 'A · Line across hero' },
            { id: 'tags', label: 'C · Tags to prediction' },
          ]}
          onChange={setLayout}
        />
        <Seg
          value={size}
          options={[
            { id: 'large', label: 'Hero large' },
            { id: 'compact', label: 'Rule-book 2rem' },
          ]}
          onChange={setSize}
        />
        <Seg
          value={aura}
          options={[
            { id: 'on', label: 'Aura on' },
            { id: 'off', label: 'Aura off' },
          ]}
          onChange={setAura}
        />
        {mounted && (
          <Seg
            value={resolvedTheme === 'light' ? 'light' : 'dark'}
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ]}
            onChange={setTheme}
          />
        )}
      </div>
      <LandingHero
        key={layout}
        layout={layout}
        heroSize={size}
        aura={aura === 'on'}
      />
    </>
  )
}
