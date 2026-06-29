import Link from 'next/link'
import { LayoutDashboard, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface CanvasToolbarProps {
  workspaceName: string
  workspaceId: string
  nodeCount: number
  isBuildMode: boolean
  hasSelection: boolean
  hasPendingChanges: boolean
  onToggleMode: (mode: 'VIEW' | 'BUILD') => void
  onAddNode: () => void
  onDeleteSelected: () => void
  onCancel: () => void
  onConfirm: () => void
}

export function CanvasToolbar({
  workspaceName,
  workspaceId,
  nodeCount,
  isBuildMode,
  hasSelection,
  hasPendingChanges,
  onToggleMode,
  onAddNode,
  onDeleteSelected,
  onCancel,
  onConfirm,
}: CanvasToolbarProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-3 bg-card border-b border-border">
      {/* Left: Canvas Title + Node Count (Fitts's Law & Visual Hierarchy: เรียงบน-ล่าง ให้อ่านง่าย) */}
      <div className="flex flex-col items-start justify-center">
        <span className="text-foreground text-base font-semibold leading-tight">
          {workspaceName}
        </span>
        <span className="text-muted-foreground text-[11px] mt-0.5">
          {nodeCount} Device{nodeCount !== 1 ? 's' : ''} — Click a node to view
          details
        </span>
      </div>

      {/* Right: Actions + Mode Toggle */}
      <div className="flex items-center gap-4">
        {isBuildMode && (
          <div className="flex items-center gap-2">
            {hasSelection && (
              <Button
                onClick={onDeleteSelected}
                size="icon"
                className="cursor-pointer w-8 h-8 rounded-md border border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                title="Delete Selected"
              >
                <Trash2 size={15} />
              </Button>
            )}

            {!hasPendingChanges && (
              <Button
                onClick={onAddNode}
                className="cursor-pointer h-8 px-4 text-xs font-semibold border border-primary bg-transparent text-primary rounded-full hover:bg-primary/10 transition-colors"
              >
                + Add Node
              </Button>
            )}

            {hasPendingChanges && (
              <>
                <Button
                  onClick={onCancel}
                  variant="ghost"
                  className="cursor-pointer h-8 px-4 text-xs font-medium text-muted-foreground rounded-full hover:bg-accent hover:text-foreground transition-colors"
                >
                  Cancel
                </Button>
                <Button
                  onClick={onConfirm}
                  className="cursor-pointer h-8 px-4 text-xs font-semibold border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 rounded-full hover:bg-emerald-500/20 transition-colors shadow-[0_0_10px_rgba(16,185,129,0.1)]"
                >
                  ✓ Confirm
                </Button>
              </>
            )}
          </div>
        )}

        {isBuildMode && <div className="w-px h-6 bg-border" />}

        <div className="flex items-center gap-3">
          <Link href={`/workspaces/${workspaceId}/details`}>
            <Button
              variant="ghost"
              className="cursor-pointer h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LayoutDashboard size={15} className="mr-2" />
              View Details
            </Button>
          </Link>

          {/* VIEW/BUILD toggle */}
          <div className="flex items-center bg-muted rounded-full border border-border p-0.5">
            {(['VIEW', 'BUILD'] as const).map(mode => {
              const active = mode === 'BUILD' ? isBuildMode : !isBuildMode
              return (
                <Button
                  key={mode}
                  onClick={() => onToggleMode(mode)}
                  className={cn(
                    'cursor-pointer h-7 px-4 text-[10px] font-bold tracking-wider rounded-full transition-all duration-200 shadow-none',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </Button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
