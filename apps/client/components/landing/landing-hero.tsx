import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand/brand-mark'
import { SignalTrace } from '@/components/auth/signal-trace'
import { cn } from '@/lib/utils'
import { DEMO_MODEL } from '@/lib/landing-demo'
import { TagFeed } from './tag-feed'
import { CursorAura } from './cursor-aura'
import { ThemeSwitcher } from './theme-switcher'
import { KPI_SECTION_ID, KpiSection } from './kpi-section'

export type LandingLayout = 'line' | 'tags'
export type HeroSize = 'large' | 'compact'

/**
 * Signed-out landing for `/`. Same language as the auth pages: the live
 * prediction line with lab samples is the one bold element; everything else
 * is quiet. `line`: the trace runs across the lower third. `tags`: input tags
 * feed the trace beside the copy.
 */
export function LandingHero({
  layout = 'line',
  heroSize = 'large',
  aura = true,
  kpis = false,
}: {
  layout?: LandingLayout
  heroSize?: HeroSize
  /** Soft pointer-following light behind the page (see CursorAura). */
  aura?: boolean
  /** Sensor-vs-lab section below the hero, reached by scrolling (and a cue
   *  at the hero's foot). Off: the hero is the whole page. */
  kpis?: boolean
}) {
  const copy = (
    <div className="max-w-3xl space-y-6">
      {/* Size first, then leading: cn()'s tailwind-merge drops a leading-*
          that comes BEFORE a text-* size. */}
      <h1
        className={cn(
          'font-semibold text-balance',
          heroSize === 'large'
            ? 'text-[clamp(2.25rem,4.5vw,3.5rem)] leading-[1.05] tracking-[-0.03em]'
            : 'text-[clamp(1.5rem,2.5vw,2rem)] leading-tight tracking-[-0.02em]',
        )}
      >
        Lab values, every hour.
      </h1>
      <p className="max-w-[60ch] text-base text-pretty text-muted-foreground">
        SoftSensor predicts the quality numbers your lab measures every six
        hours — every hour, from live process tags — and tells you when a model
        drifts.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild className="h-10 px-5">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 px-5">
          <Link href="/register">Create account</Link>
        </Button>
      </div>
    </div>
  )

  return (
    <div className="relative overflow-x-clip bg-background">
      {/* The hero fills the first screen; the aura stays inside it so its
          rest point doesn't drift down a taller page. */}
      <div className="relative flex min-h-svh flex-col">
        {aura && (
          // Rests beside the thing worth looking at: the model diagram (tags)
          // or the prediction line (line).
          <CursorAura
            rest={layout === 'tags' ? { x: 0.72, y: 0.5 } : { x: 0.6, y: 0.78 }}
          />
        )}
        <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 md:px-10">
          <Link
            href="/"
            aria-label="SoftSensor home"
            className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark surface="var(--background)" />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <ThemeSwitcher className="mr-2" />
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <Link href="/register">Create account</Link>
            </Button>
          </nav>
        </header>

        {layout === 'line' ? (
          <main className="relative z-10 flex flex-1 flex-col">
            <section className="px-6 pt-[10vh] md:px-10 md:pt-[14vh]">
              {copy}
            </section>
            <div className="relative mt-auto h-[42vh] min-h-64">
              <SignalTrace
                variant="line"
                readout
                model={DEMO_MODEL}
                labHover
                className="absolute inset-0"
              />
            </div>
          </main>
        ) : (
          <main className="relative z-10 grid flex-1 items-center gap-12 px-6 py-12 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)] md:px-10">
            {copy}
            <TagFeed />
          </main>
        )}
        {kpis && (
          <div className="relative z-10 flex justify-center pb-6">
            <a
              href={`#${KPI_SECTION_ID}`}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              See how it works
              <ChevronDown className="size-3.5" aria-hidden />
            </a>
          </div>
        )}
      </div>
      {kpis && <KpiSection />}
    </div>
  )
}
