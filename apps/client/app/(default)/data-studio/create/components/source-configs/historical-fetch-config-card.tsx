'use client'

import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CalBasis } from '@/types/pi'
import {
  BATCH_SIZE_MAX,
  BATCH_SIZE_MIN,
  CAL_BASIS_OPTIONS,
  SUMMARY_TYPE_OPTIONS,
  clampBatchSize,
  toggleSummaryType,
  type HistoricalFetchConfig,
} from '@/lib/fetch-config'

interface Props {
  config: HistoricalFetchConfig
  onChange: (next: HistoricalFetchConfig) => void
  /** Bucket size derived from the Fetch Period control — shown as the summary
   * duration placeholder so an empty override reads as "use the period". */
  derivedDuration?: string
  disabled?: boolean
}

/**
 * PI historical-fetch summary settings (Step 5): calculation basis, summary
 * aggregate(s), bucket duration override, and tag batch size. Presentational —
 * owns no state; the wizard holds the config in `dwFetchConfigAtom`.
 */
export function HistoricalFetchConfigCard({
  config,
  onChange,
  derivedDuration,
  disabled,
}: Props) {
  return (
    <div
      className={cn(
        'space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          Historical Fetch Settings
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Calculation Basis */}
        <div className="grid gap-1.5">
          <Label htmlFor="hf-cal-basis" className="text-xs">
            Calculation Basis
          </Label>
          <Select
            value={config.calBasis}
            disabled={disabled}
            onValueChange={(v: CalBasis) =>
              onChange({ ...config, calBasis: v })
            }
          >
            <SelectTrigger id="hf-cal-basis" className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAL_BASIS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Batch Size */}
        <div className="grid gap-1.5">
          <Label htmlFor="hf-batch-size" className="text-xs">
            Batch Size
          </Label>
          <input
            id="hf-batch-size"
            type="number"
            min={BATCH_SIZE_MIN}
            max={BATCH_SIZE_MAX}
            value={config.batchSize}
            disabled={disabled}
            onChange={e =>
              onChange({
                ...config,
                batchSize: clampBatchSize(Number(e.target.value)),
              })
            }
            className="h-9 rounded-md border border-border bg-background px-2.5 font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Tags per request ({BATCH_SIZE_MIN}–{BATCH_SIZE_MAX}).
          </p>
        </div>

        {/* Summary Duration override */}
        <div className="grid gap-1.5">
          <Label htmlFor="hf-summary-duration" className="text-xs">
            Summary Duration
          </Label>
          <input
            id="hf-summary-duration"
            type="text"
            value={config.summaryDuration}
            disabled={disabled}
            placeholder={derivedDuration ?? 'e.g. 1m, 10m, 1h'}
            onChange={e =>
              onChange({ ...config, summaryDuration: e.target.value.trim() })
            }
            className="h-9 rounded-md border border-border bg-background px-2.5 font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Bucket size. Blank uses the Fetch Period above.
          </p>
        </div>

        {/* Summary Type (multi) */}
        <div className="grid gap-1.5">
          <Label className="text-xs">Summary Type</Label>
          <div className="flex flex-wrap gap-1.5">
            {SUMMARY_TYPE_OPTIONS.map(o => {
              const active = config.summaryType.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...config,
                      summaryType: toggleSummaryType(
                        config.summaryType,
                        o.value,
                      ),
                    })
                  }
                  className={cn(
                    'h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent text-foreground ring-1 ring-border hover:bg-muted',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
