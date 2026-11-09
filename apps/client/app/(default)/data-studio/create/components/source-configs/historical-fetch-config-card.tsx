'use client'

import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
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
  parseBatchSizeInput,
  type HistoricalFetchConfig,
} from '@/lib/fetch-config'

interface Props {
  config: HistoricalFetchConfig
  onChange: (next: HistoricalFetchConfig) => void
  /** Bucket size derived from the Interval control — shown as the summary
   * duration placeholder so an empty override reads as "use the interval". */
  derivedDuration?: string
  disabled?: boolean
}

/**
 * PI historical-fetch summary settings (Step 2): calculation basis, summary
 * aggregate, tag batch size, and - under Advanced - a bucket override.
 *
 * 2026-10-19: Summary Type is ONE choice. It was a multi-select, but the
 * fetch reads only the first aggregate (`data_service.fetch`:
 * `body.summary_type[0]`), so extra picks did nothing. The bucket override
 * moved under Advanced: the Interval control above is the normal way to set
 * it, and two visible bucket fields read as a duplicate. The wizard holds
 * the config in `dwFetchConfigAtom`; the only local state is the Batch Size
 * box's typed text, so a half-typed or invalid value never reaches the config.
 */
export function HistoricalFetchConfigCard({
  config,
  onChange,
  derivedDuration,
  disabled,
}: Props) {
  // Batch Size is a plain text box: free typing, checked against 1..1000.
  // Only a valid number is sent up; the config keeps its last valid value
  // while the box holds anything else.
  const [batchText, setBatchText] = useState(String(config.batchSize))
  const [batchTouched, setBatchTouched] = useState(false)
  // Follow the config when it changes from elsewhere (a resumed draft).
  const [syncedBatch, setSyncedBatch] = useState(config.batchSize)
  if (config.batchSize !== syncedBatch) {
    setSyncedBatch(config.batchSize)
    if (parseBatchSizeInput(batchText) !== config.batchSize) {
      setBatchText(String(config.batchSize))
      setBatchTouched(false)
    }
  }
  const batchInvalid = batchTouched && parseBatchSizeInput(batchText) === null
  // Open on arrival when an override is already set, so it is never hidden.
  const [advancedOpen, setAdvancedOpen] = useState(
    config.summaryDuration.trim() !== '',
  )
  const summaryType = config.summaryType[0]

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
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={batchText}
            disabled={disabled}
            aria-invalid={batchInvalid}
            aria-describedby="hf-batch-size-hint"
            onChange={e => {
              const raw = e.target.value
              setBatchText(raw)
              const n = parseBatchSizeInput(raw)
              if (n !== null && n !== config.batchSize) {
                onChange({ ...config, batchSize: n })
              }
            }}
            onBlur={() => setBatchTouched(true)}
            className={cn(
              'h-9 rounded-md border border-border bg-background px-2.5 font-mono text-sm',
              batchInvalid && 'border-destructive',
            )}
          />
          <p
            id="hf-batch-size-hint"
            className={cn(
              'text-[11px]',
              batchInvalid ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {batchInvalid
              ? `Enter a whole number from ${BATCH_SIZE_MIN} to ${BATCH_SIZE_MAX}. Using ${config.batchSize} until then.`
              : `Tags per request (${BATCH_SIZE_MIN}–${BATCH_SIZE_MAX}).`}
          </p>
        </div>

        {/* Summary Type (one choice) */}
        <div className="grid gap-1.5">
          <Label id="hf-summary-type" className="text-xs">
            Summary Type
          </Label>
          <div
            role="group"
            aria-labelledby="hf-summary-type"
            className="flex flex-wrap gap-1.5"
          >
            {SUMMARY_TYPE_OPTIONS.map(o => {
              const active = summaryType === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() =>
                    onChange({ ...config, summaryType: [o.value] })
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

      {/* Advanced: the bucket override. */}
      <div className="space-y-3">
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="hf-advanced"
          onClick={() => setAdvancedOpen(o => !o)}
          disabled={disabled}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform',
              !advancedOpen && '-rotate-90',
            )}
          />
          Advanced
          {config.summaryDuration.trim() && !advancedOpen && (
            <span className="font-mono">
              · Summary Duration {config.summaryDuration}
            </span>
          )}
        </button>
        {advancedOpen && (
          <div id="hf-advanced">
            <div className="grid max-w-xs gap-1.5">
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
                  onChange({
                    ...config,
                    summaryDuration: e.target.value.trim(),
                  })
                }
                className="h-9 rounded-md border border-border bg-background px-2.5 font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Overrides the Interval above (e.g. 30m). Blank uses the
                Interval.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
