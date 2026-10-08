import { Plus } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { ATTENTION_TEXT } from '@/components/workspace/workspace-parts'
import type { SummarySegment } from '@/lib/admin-dashboard'
import { cn } from '@/lib/utils'

/**
 * Title, the one-line platform summary (replaces the KPI cards) and Create.
 * Every segment is real: "—" until it has loaded, never a guessed number.
 */
export function AdminSummaryHeader({
  segments,
  onCreate,
}: {
  segments: SummarySegment[]
  onCreate: () => void
}) {
  return (
    <div className="space-y-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Admin</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-1.5">
          <h1 className="text-[clamp(1.5rem,2.5vw,2rem)] leading-tight font-semibold tracking-[-0.02em]">
            Admin dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Workspaces, equipment status and sign-in activity across the
            platform.
          </p>
          <p
            className="font-mono text-sm tabular-nums"
            data-testid="admin-summary"
          >
            {segments.map((seg, i) => (
              <span key={seg.key}>
                {i > 0 && <span className="text-muted-foreground"> · </span>}
                <span className={cn(seg.attention && ATTENTION_TEXT)}>
                  {seg.value === null ? (
                    <>
                      <span aria-hidden>—</span>
                      <span className="sr-only">unknown</span>
                    </>
                  ) : (
                    seg.value
                  )}{' '}
                  {seg.label}
                </span>
              </span>
            ))}
          </p>
        </div>
        <Button
          onClick={onCreate}
          className="h-9 gap-2 self-start md:self-auto"
        >
          <Plus className="size-4" />
          Create workspace
        </Button>
      </div>
    </div>
  )
}
