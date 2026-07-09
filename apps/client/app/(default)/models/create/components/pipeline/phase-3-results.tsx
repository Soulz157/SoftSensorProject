'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Loader2,
  Pencil,
  RotateCw,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { toModelReady } from '@/lib/preprocessing'
import { materializeDataset } from '@/lib/pipeline-config'
import type { PipelineConfig } from '@/lib/pipeline-config'
import {
  computeMetrics,
  METRIC_KEYS,
  METRIC_META,
  type MetricKey,
} from '@/lib/model-metrics'
import { mpSelectedMetricsAtom, mpModeAtom } from '@/store/model-pipeline'
import { ScatterRegressionChart } from '@/app/(default)/data-visualize/components/scatter-regression-chart'
import { useModelCommit } from '@/hooks/model/use-model-commit'
import { useRefreshModels } from '@/hooks/use-all-models'
import { StatTile } from '../stat-tile'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3Results({ nav }: Props) {
  const router = useRouter()
  const { selectedDataset, targetVariable } = nav
  const [selectedMetrics, setSelectedMetrics] = useAtom(mpSelectedMetricsAtom)
  const mode = useAtomValue(mpModeAtom)
  const commit = useModelCommit()
  const refreshModels = useRefreshModels()
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await commit()
      refreshModels()
      toast.success('Changes saved')
      router.push('/models/views')
    } catch {
      toast.error('Failed to save changes. Please try again.')
      setSaving(false)
    }
  }

  const modelReady = useMemo(() => {
    if (!selectedDataset) return { tags: [], rows: [] }
    return toModelReady(
      materializeDataset(
        selectedDataset.tags,
        selectedDataset.pipelineConfig as PipelineConfig,
      ),
    )
  }, [selectedDataset])

  const pair = useMemo(() => {
    if (!targetVariable) return null
    const xTag = modelReady.tags.find(t => t !== targetVariable)
    return xTag ? { xTag, yTag: targetVariable } : null
  }, [modelReady.tags, targetVariable])

  const metrics = useMemo(
    () => (pair ? computeMetrics(modelReady, pair.xTag, pair.yTag) : null),
    [modelReady, pair],
  )

  const valueFor = (key: MetricKey): string => {
    if (!metrics || metrics.n < 2) return '—'
    return METRIC_META[key].format(metrics[key])
  }
  const accentFor = (key: MetricKey): string | undefined => {
    if (!metrics || metrics.n < 2) return undefined
    return METRIC_META[key].accent?.(metrics[key])
  }

  const toggleMetric = (key: MetricKey, on: boolean) => {
    setSelectedMetrics(prev =>
      on
        ? METRIC_KEYS.filter(k => prev.includes(k) || k === key)
        : prev.filter(k => k !== key),
    )
  }

  const visible = METRIC_KEYS.filter(k => selectedMetrics.includes(k))

  const handleRetrain = () => {
    nav.goTo(2)
  }

  return (
    <div className="space-y-5">
      {/* Success banner */}
      <div className="flex items-center gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 ring-1 ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            Training complete
          </p>
          <p className="text-xs text-muted-foreground">
            {pair
              ? `Fit on ${pair.yTag} vs ${pair.xTag} · ${metrics?.n ?? 0} samples`
              : 'Select a target variable to evaluate a fit.'}
          </p>
        </div>
      </div>

      {/* Metric selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          Evaluation metrics
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Metrics
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Show metrics</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {METRIC_KEYS.map(key => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={selectedMetrics.includes(key)}
                disabled={
                  selectedMetrics.length === 1 && selectedMetrics.includes(key)
                }
                onCheckedChange={on => toggleMetric(key, on)}
              >
                {METRIC_META[key].label} — {METRIC_META[key].hint}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Metric cards */}
      <div
        className={cn(
          'grid gap-4',
          visible.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {visible.map(key => (
          <StatTile
            key={key}
            label={METRIC_META[key].label}
            value={valueFor(key)}
            sub={METRIC_META[key].hint}
            toneClassName={accentFor(key)}
          />
        ))}
      </div>

      {/* Fit visualization */}
      {pair && metrics && metrics.n >= 2 && (
        <ScatterRegressionChart dataset={modelReady} />
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRetrain}>
            <RotateCw className="h-4 w-4" />
            Retrain
          </Button>
          <Button variant="outline" onClick={() => nav.goTo(1)}>
            <Pencil className="h-4 w-4" />
            Edit details
          </Button>
        </div>
        {mode === 'edit' ? (
          <>
            <Button onClick={handleSave} disabled={saving} aria-busy={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
            <span className="sr-only" role="status" aria-live="polite">
              {saving ? 'Saving changes…' : ''}
            </span>
          </>
        ) : (
          <Button onClick={() => router.push('/models/views')}>Done</Button>
        )}
      </div>
    </div>
  )
}
