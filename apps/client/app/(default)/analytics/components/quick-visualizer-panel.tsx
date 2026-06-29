'use client'

import Link from 'next/link'
import { Download, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { SensorTrendChart } from '@/app/(default)/data-visualize/components/sensor-trend-chart'
import { ScatterRegressionChart } from '@/app/(default)/data-visualize/components/scatter-regression-chart'
import { TimeRangeToggle } from '@/app/(default)/data-visualize/components/time-range-toggle'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import { useQuickVisualizer } from '@/hooks/use-quick-visualizer'

const MODES = [
  { id: 'line', label: 'Line' },
  { id: 'scatter', label: 'Scatter' },
] as const

export function QuickVisualizerPanel() {
  const {
    selectedTags,
    toggleTag,
    range,
    setRange,
    mode,
    setMode,
    rows,
    dataset,
    isFetching,
    exportCsv,
  } = useQuickVisualizer()

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base font-medium">
            Quick Visualizer
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Select tags and plot them instantly — no wizard required
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Chart type"
            className="flex overflow-hidden rounded-lg border border-border"
          >
            {MODES.map(m => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === m.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <TimeRangeToggle value={range} onChange={setRange} />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={exportCsv}
            disabled={selectedTags.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export Data
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/data-visualize">
              <ExternalLink className="h-3.5 w-3.5" />
              Open Full Visualizer
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {MOCK_PI_TAGS.map(tag => {
            const checked = selectedTags.includes(tag.piTag)
            return (
              <Label
                key={tag.piTag}
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleTag(tag.piTag)}
                  aria-label={`Plot ${tag.piTag}`}
                />
                <span className="font-medium text-foreground">{tag.piTag}</span>
                <span className="text-muted-foreground">{tag.label}</span>
              </Label>
            )
          })}
        </div>

        {mode === 'line' ? (
          <SensorTrendChart
            rows={rows}
            tags={selectedTags}
            range={range}
            dimmed={isFetching}
          />
        ) : (
          <ScatterRegressionChart dataset={dataset} />
        )}
      </CardContent>
    </Card>
  )
}
