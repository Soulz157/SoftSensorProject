'use client'

import { Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ALGORITHMS,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'

const MAX = 3

/**
 * Algorithms the trainer can't run yet (images/trainer/train.py `build_model`
 * — needs a windowed 3D input the pipeline doesn't build). Disabled here so
 * the refusal is where the choice is made, not three layers downstream at
 * run creation (MODEL-FLOW-003-T10). Neutral/muted styling only — red/amber
 * are reserved for workspace and plant status, not catalogue availability.
 */
const DEFERRED_REASON: Partial<Record<Algorithm, string>> = {
  lstm: 'Needs sequence support not yet in the trainer',
  gru: 'Needs sequence support not yet in the trainer',
}

interface Props {
  algorithms: Algorithm[]
  onChange: (algorithms: Algorithm[]) => void
}

/**
 * Multi-select algorithm picker (up to 3). The first selected is the primary
 * (drives the manual hyperparameter grid). At least one must stay selected.
 */
export function AlgorithmSelector({ algorithms, onChange }: Props) {
  const atCap = algorithms.length >= MAX

  const toggle = (a: Algorithm, on: boolean) => {
    if (on) {
      if (atCap || algorithms.includes(a)) return
      onChange([...algorithms, a])
    } else {
      if (algorithms.length <= 1) return // keep at least one
      onChange(algorithms.filter(x => x !== a))
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        Algorithms{' '}
        <span className="text-muted-foreground">
          ({algorithms.length}/{MAX})
        </span>
      </Label>

      <div className="flex flex-wrap items-center gap-1.5">
        {algorithms.map((a, i) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {i === 0 && (
              <span className="text-[10px] font-semibold uppercase opacity-70">
                primary
              </span>
            )}
            {ALGORITHM_LABELS[a]}
            <button
              type="button"
              onClick={() => toggle(a, false)}
              disabled={algorithms.length <= 1}
              aria-label={`Remove ${ALGORITHM_LABELS[a]}`}
              className="rounded-full p-0.5 transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={atCap}
            >
              <Plus className="h-3.5 w-3.5" />
              Add algorithm
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-full">
            <DropdownMenuLabel>Select up to {MAX}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALGORITHMS.map(a => {
              const checked = algorithms.includes(a)
              const deferredReason = DEFERRED_REASON[a]
              return (
                <DropdownMenuCheckboxItem
                  key={a}
                  checked={checked}
                  disabled={
                    // deferredReason only blocks SELECTING it — a hydrated
                    // draft that already carries a deferred algorithm must
                    // still be able to uncheck it here, subject to the same
                    // "keep at least one" rule every algorithm follows.
                    (!checked && Boolean(deferredReason)) ||
                    (!checked && atCap) ||
                    (checked && algorithms.length <= 1)
                  }
                  onCheckedChange={on => toggle(a, on)}
                  className="cursor-pointer"
                >
                  <span className="flex flex-col">
                    <span>{ALGORITHM_LABELS[a]}</span>
                    {deferredReason && (
                      <span className="text-[10px] text-muted-foreground">
                        {deferredReason}
                      </span>
                    )}
                  </span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
