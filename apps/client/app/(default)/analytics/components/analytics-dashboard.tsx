'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useDataIntake } from '@/hooks/analytics/use-data-intake'
import { canViewScope, type Scope } from '@/lib/data-intake'
import type { IntakeRange } from '@/types/data-intake'
import { cn } from '@/lib/utils'
import { DataIntakeHeader } from './data-intake-header'
import { IntakeSummary } from './intake-summary'
import { IngestionChart } from './ingestion-chart'
import { TagProportion } from './tag-proportion'
import { LiveTagTable } from './live-tag-table'
import { DatasetStorage } from './dataset-storage'
import { WorkspaceIntakeTable } from './workspace-intake-table'
import { IntakeError, IntakeSkeleton } from './intake-states'

/** Composition shell: scope + range state, then the sections for whichever
 *  scope the loaded figures belong to. */
export function AnalyticsDashboard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  // Only admins switch scope: the all-workspaces view lives under /admin, and
  // a user's Data Intake page shows the one workspace they opened.
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'ADMIN'
  const scope: Scope = workspaceId || 'all'
  const [range, setRange] = useState<IntakeRange>('24h')

  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  // A user's workspace list holds only their own workspaces, so an id that is
  // not in it is one they are not a member of (a hand-typed URL).
  const noAccess = !workspacesLoading && !canViewScope(scope, workspaces)

  const { data, state, isFetching, error, refetch } = useDataIntake(
    scope,
    range,
    !noAccess,
  )

  const handleScopeChange = (next: Scope) => {
    router.push(next === 'all' ? '/admin/analytics' : `/analytics/${next}`)
  }

  if (noAccess) {
    return (
      <Card className="flex flex-col items-start gap-4 border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Workspace not found or you do not have access.
        </p>
        <Button asChild>
          <Link href="/workspaces">Back to Workspaces</Link>
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <DataIntakeHeader
        workspaces={workspaces}
        showScopeSelect={isAdmin}
        scope={scope}
        onScopeChange={handleScopeChange}
        range={range}
        onRangeChange={setRange}
        onRefresh={refetch}
        isFetching={isFetching}
      />

      {state === 'error' ? (
        <IntakeError
          message={error ?? "Couldn't load data intake."}
          onRetry={refetch}
        />
      ) : state === 'loading' || data === null ? (
        <IntakeSkeleton />
      ) : (
        <div
          aria-busy={isFetching}
          className={cn('space-y-6', isFetching && 'opacity-60')}
        >
          <IntakeSummary totals={data.totals} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <IngestionChart points={data.ingestion} range={range} />
            <TagProportion counts={data.totals.tags} />
          </div>

          {data.scope === 'workspace' ? (
            <>
              <LiveTagTable rows={data.tags} now={new Date(data.to)} />
              <DatasetStorage
                datasets={data.datasets}
                storage={data.totals.storage}
              />
            </>
          ) : (
            <WorkspaceIntakeTable rows={data.workspaces} />
          )}
        </div>
      )}
    </div>
  )
}
