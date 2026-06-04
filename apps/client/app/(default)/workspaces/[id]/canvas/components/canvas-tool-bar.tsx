import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CanvasToolbarProps {
  workspaceName: string
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
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-2.5 bg-[#111320] border-b border-[#1e2235]">
      {/* Left: canvas title + node count */}
      <div className="flex-1 items-center gap-2">
        <span className="text-[#e2e5f0] text-md font-semibold">
          {workspaceName}
        </span>
        <div>
          <span className="text-[#4b5563] text-xs">
            {nodeCount} Node{nodeCount !== 1 ? 's' : ''} — Click a node to view
            details
          </span>
        </div>
      </div>

      {/* Right: actions + mode toggle */}
      <div className="flex items-center gap-2">
        {isBuildMode && hasSelection && (
          <button
            onClick={onDeleteSelected}
            className="flex items-center justify-center w-7.5 h-7.5 rounded-lg border border-red-500 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        )}

        {isBuildMode && (
          <button
            onClick={onAddNode}
            className="px-3.5 py-1.25 text-[11px] font-semibold cursor-pointer border border-[#6366f1] bg-transparent text-[#6366f1] rounded-full hover:bg-[#6366f1]/10 transition-colors"
          >
            + Add Node
          </button>
        )}

        {isBuildMode && hasPendingChanges && (
          <>
            <button
              onClick={onCancel}
              className="px-3.5 py-1.25 text-[11px] font-semibold cursor-pointer border border-[#374151] bg-transparent text-[#6b7280] rounded-full hover:bg-white/5 hover:text-[#9ca3af] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-3.5 py-1.25 text-[11px] font-semibold cursor-pointer border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 rounded-full hover:bg-emerald-500/20 transition-colors"
            >
              ✓ Confirm
            </button>
          </>
        )}

        {/* VIEW/BUILD toggle */}
        <div className="flex items-center bg-[#1a1d2e] rounded-full border border-[#2d3147] overflow-hidden">
          {(['VIEW', 'BUILD'] as const).map(mode => {
            const active = mode === 'BUILD' ? isBuildMode : !isBuildMode
            return (
              <button
                key={mode}
                onClick={() => onToggleMode(mode)}
                className={cn(
                  'px-3.5 py-1.25 text-[11px] font-semibold tracking-wider cursor-pointer border-none transition-all duration-150',
                  active
                    ? 'bg-[#6366f1] text-white rounded-full'
                    : 'bg-transparent text-[#4b5563]',
                )}
              >
                {mode}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
