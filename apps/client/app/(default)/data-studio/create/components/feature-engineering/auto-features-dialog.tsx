'use client'

import { useMemo, useState } from 'react'
import { Info, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { FeatureConfig } from '@/lib/feature-engineering'
import {
  AUTO_FAMILIES,
  DEFAULT_AUTO_FAMILIES,
  findLoopGroups,
  formatIntervalMs,
  planAutoFeatures,
  type AutoFamily,
} from '@/lib/auto-features'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Step 1 source tags - the only columns a generated feature reads. */
  sourceColumns: string[]
  targetTag: string | null
  /** Starred in Step 1; the pairwise family pairs these. */
  criticalTags: string[]
  intervalMs: number | null
  /** Where the interval came from, shown beside it. */
  intervalSource: 'data' | 'fetch' | null
  rowCount: number | null
  /** Every column the frame already has (raw + engineered). */
  existingColumns: string[]
  onAdd: (configs: FeatureConfig[]) => void
}

/**
 * Step 4 "Auto-generate": picks feature families and tags, shows exactly what
 * would be added (and what was left out, and why) before anything is written.
 * The recipe itself is `planAutoFeatures` (lib/auto-features.ts).
 */
export function AutoFeaturesDialog({
  open,
  onOpenChange,
  sourceColumns,
  targetTag,
  criticalTags,
  intervalMs,
  intervalSource,
  rowCount,
  existingColumns,
  onAdd,
}: Props) {
  const candidates = useMemo(
    () => sourceColumns.filter(t => t !== targetTag),
    [sourceColumns, targetTag],
  )
  const pairTags = useMemo(
    () => criticalTags.filter(t => candidates.includes(t)),
    [criticalTags, candidates],
  )
  const [families, setFamilies] = useState<AutoFamily[]>([
    ...DEFAULT_AUTO_FAMILIES,
  ])
  // null = every candidate; a list once the engineer narrows it.
  const [picked, setPicked] = useState<string[] | null>(null)
  const tags = picked ?? candidates
  const loops = useMemo(() => findLoopGroups(candidates), [candidates])
  const [skippedLoops, setSkippedLoops] = useState<string[]>([])
  const loopGroups = useMemo(
    () => loops.filter(g => !skippedLoops.includes(g.loop)),
    [loops, skippedLoops],
  )

  const plan = useMemo(
    () =>
      planAutoFeatures({
        tags,
        targetTag,
        intervalMs,
        // A family whose checkbox is disabled is not asked for.
        families: families.filter(
          f =>
            !(f === 'loop' && loops.length === 0) &&
            !(f === 'pairwise' && pairTags.length < 2),
        ),
        pairTags,
        loopGroups,
        existingColumns,
        rowCount,
      }),
    [
      tags,
      targetTag,
      intervalMs,
      families,
      loops.length,
      pairTags,
      loopGroups,
      existingColumns,
      rowCount,
    ],
  )

  const toggleFamily = (f: AutoFamily, on: boolean) =>
    setFamilies(prev => (on ? [...prev, f] : prev.filter(x => x !== f)))
  const toggleTag = (t: string, on: boolean) =>
    setPicked(
      on
        ? candidates.filter(c => c === t || tags.includes(c))
        : tags.filter(x => x !== t),
    )

  const close = (next: boolean) => {
    if (!next) {
      setFamilies([...DEFAULT_AUTO_FAMILIES])
      setPicked(null)
      setSkippedLoops([])
    }
    onOpenChange(next)
  }

  const add = () => {
    onAdd(plan.configs)
    close(false)
  }

  const intervalText =
    intervalMs === null
      ? 'unknown'
      : `${formatIntervalMs(intervalMs)}${intervalSource === 'data' ? ' (from the data)' : ''}`

  return (
    <Dialog open={open} onOpenChange={close}>
      {/* `sm:` width, not a bare `max-w-*`: DialogContent's own `sm:max-w-sm`
          wins at every desktop width otherwise, which kept this at 24rem. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Auto-generate features
          </DialogTitle>
          <DialogDescription>
            Adds lag, rolling, difference, loop and time features from the
            source tags. Windows are capped at 24 h and converted to rows at
            this dataset&apos;s interval: {intervalText}. The target is never
            used.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-foreground">Families</h3>
          <ul className="space-y-1.5">
            {AUTO_FAMILIES.map(({ family, label, detail }) => {
              const id = `auto-family-${family}`
              const pairBlocked =
                (family === 'pairwise' && pairTags.length < 2) ||
                (family === 'loop' && loops.length === 0)
              return (
                <li
                  key={family}
                  className="flex flex-wrap items-start gap-2 text-xs"
                >
                  <Checkbox
                    id={id}
                    checked={families.includes(family) && !pairBlocked}
                    disabled={pairBlocked}
                    onCheckedChange={c => toggleFamily(family, c === true)}
                  />
                  {/* flex-1 + min-w-0: the row wraps (for the loop list below), and
                      without these a long label - Pairwise naming its tags -
                      wrapped as a whole box under the checkbox. */}
                  <label htmlFor={id} className="min-w-0 flex-1 leading-tight">
                    <span className="font-medium text-foreground">{label}</span>{' '}
                    <span className="text-muted-foreground">
                      {pairBlocked
                        ? family === 'loop'
                          ? '- no loop with 2 or more tags (e.g. AI602A and AI602B) in this dataset'
                          : '- star at least 2 critical tags in Step 1 to pair them'
                        : family === 'pairwise'
                          ? `- ${detail}: ${pairTags.join(', ')}`
                          : `- ${detail}`}
                    </span>
                  </label>
                  {family === 'loop' &&
                    families.includes('loop') &&
                    loops.length > 0 && (
                      <ul className="mt-1 basis-full space-y-1 pl-6">
                        {loops.map(g => {
                          const loopId = `auto-loop-${g.loop}`
                          return (
                            <li
                              key={g.loop}
                              className="flex items-center gap-2"
                            >
                              <Checkbox
                                id={loopId}
                                checked={!skippedLoops.includes(g.loop)}
                                onCheckedChange={c =>
                                  setSkippedLoops(prev =>
                                    c === true
                                      ? prev.filter(l => l !== g.loop)
                                      : [...prev, g.loop],
                                  )
                                }
                              />
                              <label
                                htmlFor={loopId}
                                className="font-mono text-muted-foreground"
                              >
                                <span className="text-foreground">
                                  {g.loop}
                                </span>{' '}
                                ({g.tags.join(', ')})
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-foreground">
              Source tags{' '}
              <span className="font-normal text-muted-foreground">
                {tags.length} of {candidates.length}
              </span>
            </h3>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setPicked(null)}
              >
                All
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setPicked([])}
              >
                None
              </Button>
            </div>
          </div>
          <ul className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto overscroll-contain rounded-md border border-border p-2 sm:grid-cols-2 md:grid-cols-3">
            {candidates.map(t => {
              const id = `auto-tag-${t}`
              return (
                <li key={t} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    id={id}
                    checked={tags.includes(t)}
                    onCheckedChange={c => toggleTag(t, c === true)}
                  />
                  <label htmlFor={id} className="truncate font-mono">
                    {t}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="space-y-1.5 rounded-md bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground" aria-live="polite">
            {plan.configs.length === 0
              ? 'Nothing to add with these choices.'
              : `Adds ${plan.configs.length} features`}
          </p>
          {plan.configs.length > 0 && (
            <p className="text-muted-foreground">
              {AUTO_FAMILIES.filter(f => plan.counts[f.family] > 0)
                .map(f => `${plan.counts[f.family]} ${f.label.toLowerCase()}`)
                .join(' · ')}
              {plan.lagRows.length > 0 &&
                ` · lags ${plan.lagRows.join(', ')} rows`}
              {plan.rollingRows.length > 0 &&
                ` · windows ${plan.rollingRows.join(', ')} rows`}
            </p>
          )}
          {plan.notes.map(note => (
            <p
              key={note}
              className="flex items-start gap-1 text-muted-foreground"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {note}
            </p>
          ))}
          <p className="flex items-start gap-1 text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Lag and rolling columns have no value for their first rows and
            around gaps in the source; rows left without a value after Step 5
            are dropped.
          </p>
        </section>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={add}
            disabled={plan.configs.length === 0}
          >
            Add {plan.configs.length} features
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
