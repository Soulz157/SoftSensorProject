'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAllModels } from '@/hooks/use-all-models'
import { deployCounts, deployVerdict } from '@/lib/model-status'
import type { DeployStatus } from '@/lib/model-status'
import { DeployVerdictBanner } from './components/deploy-verdict-banner'
import { DeploySummaryPills } from './components/deploy-summary-pills'
import { DeployedTable } from './components/deployed-table'

export default function DeployedPage() {
  const { models, loading, isFetching, refetch } = useAllModels()
  const [filter, setFilter] = useState<DeployStatus | null>(null)

  const all = models ?? []
  const counts = deployCounts(all)
  const verdict = deployVerdict(all)

  const filtered = filter
    ? all.filter(m => (m.data?.deployStatus ?? 'stopped') === filter)
    : all

  // Auto-refresh while any model is initializing
  useEffect(() => {
    if (counts.initializing === 0) return
    const id = setInterval(() => void refetch(), 10_000)
    return () => clearInterval(id)
  }, [counts.initializing, refetch])

  function toggleFilter(key: DeployStatus) {
    setFilter(prev => (prev === key ? null : key))
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold text-foreground">
                Check Deployed
              </h1>
            </div>
            <p className="mt-0.5 pl-8 text-sm text-muted-foreground">
              Deployment status across all workspaces
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
            Refresh
          </Button>
        </div>

        <DeployVerdictBanner verdict={verdict} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Filter by status
            </p>
            {filter && (
              <button
                onClick={() => setFilter(null)}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border hover:text-foreground"
              >
                × clear
              </button>
            )}
          </div>
          <DeploySummaryPills
            counts={counts}
            active={filter}
            onToggle={toggleFilter}
          />
        </div>

        <div className="rounded-lg border border-border bg-card">
          <DeployedTable
            models={filtered}
            loading={loading}
            isFetching={isFetching}
          />
        </div>
      </div>
    </div>
  )
}
