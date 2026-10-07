import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkspaceSummary } from '@/lib/workspace-list'
import { cn } from '@/lib/utils'
import { ATTENTION_TEXT } from './workspace-parts'

const plural = (n: number | null, one: string, many: string) =>
  n === 1 ? one : many

/** Title, the one-line summary (replaces the two KPI cards) and Create. */
export function WorkspacesHeader({
  summary,
  onCreate,
}: {
  summary: WorkspaceSummary
  onCreate: () => void
}) {
  const n = (v: number | null) => (v === null ? '—' : v)
  return (
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="space-y-1.5">
        <h1 className="text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-semibold tracking-[-0.02em]">
          Workspaces
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage and monitor your industrial workspaces.
        </p>
        <p
          className="font-mono text-sm tabular-nums"
          data-testid="workspaces-summary"
        >
          {summary.total} {plural(summary.total, 'workspace', 'workspaces')}
          <span className="text-muted-foreground"> · </span>
          <span
            className={cn(
              summary.attention !== null &&
                summary.attention > 0 &&
                ATTENTION_TEXT,
            )}
          >
            {n(summary.attention)}{' '}
            {summary.attention === 1 ? 'needs attention' : 'need attention'}
          </span>
          <span className="text-muted-foreground"> · </span>
          {n(summary.models)} {plural(summary.models, 'model', 'models')}
        </p>
      </div>
      <Button onClick={onCreate} className="h-9 gap-2 self-start md:self-auto">
        <Plus className="size-4" />
        Create workspace
      </Button>
    </div>
  )
}
