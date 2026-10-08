'use client'

import { formatDistanceToNow } from 'date-fns'
import { FileClock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ALGORITHM_LABELS } from '@/store/model-pipeline'
import { isAlgorithm } from '@/lib/model-draft-hydration'
import type { ModelDraft } from '@/services/model-draft'

/**
 * Rows shown before the list starts scrolling. Past this the panel would push
 * the preset picker and the dataset grid below the fold on a laptop, which is
 * the opposite of what a "pick up where you left off" affordance should do.
 */
const VISIBLE_ROWS = 5

/** Row height (py-2 + two text lines) — the scroll cap is 5 of these. */
const ROW_HEIGHT_REM = 3.5

interface Props {
  drafts: ModelDraft[]
  loading: boolean
  workspaceName: (id: string) => string
  onResume: (draftId: string) => void
  onRemove: (draft: ModelDraft) => void
  selectedIds: string[]
  onToggleSelect: (draftId: string) => void
  onRemoveSelected: () => void
  onRemoveAll: () => void
}

/**
 * Unfinished Model Creation drafts (MODEL-FLOW-010-T08) — the way back into a
 * wizard the user left, most often to go and edit the dataset it points at.
 *
 * Presentation only. `DraftResumeSection` owns the fetch, the confirm and the
 * resume itself; keeping this half free of them is what let the panel move
 * from the models list into Step 1 unchanged.
 *
 * Renders NOTHING when there are no drafts, rather than an empty state: this
 * is not the step's subject, and a permanent "no drafts" card would be noise
 * every time someone starts a model.
 *
 * Resume, plus three ways to clear drafts out: the row X, Remove selected
 * (tick the rows you mean), and Remove all. Clearing was deferred to
 * MODEL-FLOW-011 (ModelDraft Lifecycle Reclaim) until the user asked for it
 * directly on 2026-08-21 — reasonably, since a list that only ever grows is a
 * list you stop reading. All three ABANDON rather than delete, and all three
 * go through the same confirm; MODEL-FLOW-011 still owns reclaiming the rows
 * themselves.
 *
 * The checkbox lives in the row's `label`, so ticking works anywhere along the
 * name and metadata — the same shape `tag-list-section` already uses. Resume
 * and X sit outside it, or clicking either would also toggle the selection.
 *
 * Past `VISIBLE_ROWS` the list scrolls instead of growing, so the panel can
 * never push the preset picker and the dataset grid off the screen.
 *
 * No amber or red anywhere: those are reserved for workspace and plant status.
 * A draft is unfinished work, not a fault.
 */
export function DraftResumePanel({
  drafts,
  loading,
  workspaceName,
  onResume,
  onRemove,
  selectedIds,
  onToggleSelect,
  onRemoveSelected,
  onRemoveAll,
}: Props) {
  // Nothing while loading, not a skeleton: having no drafts is the common
  // case, so a placeholder would flash on every visit and then collapse.
  if (loading || drafts.length === 0) return null

  const scrolls = drafts.length > VISIBLE_ROWS
  const selectedCount = selectedIds.length

  const list = (
    <ul className="divide-y divide-border">
      {drafts.map(draft => (
        <li
          key={draft.id}
          className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox
              checked={selectedIds.includes(draft.id)}
              onCheckedChange={() => onToggleSelect(draft.id)}
              aria-label={`Select draft ${draft.name?.trim() || 'Untitled draft'}`}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {draft.name?.trim() || 'Untitled draft'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  workspaceName(draft.workspaceId),
                  algorithmLabel(draft.algorithm),
                  draft.targetY ? `target ${draft.targetY}` : null,
                  `edited ${formatDistanceToNow(new Date(draft.updatedAt), {
                    addSuffix: true,
                  })}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </label>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onResume(draft.id)}
            >
              Resume
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(draft)}
              // Icon-only, so the name goes in the label rather than the
              // markup — a screen reader otherwise hears five identical
              // "remove" buttons with no way to tell them apart.
              aria-label={`Remove draft ${draft.name?.trim() || 'Untitled draft'}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileClock className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Drafts in progress
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {drafts.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* Only once something is ticked. A permanently visible
              "Remove selected (0)" is a disabled control the user has to
              read past on every visit. */}
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onRemoveSelected}>
              Remove selected ({selectedCount})
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onRemoveAll}>
            Remove all
          </Button>
        </div>
      </div>

      {/* Only past the cap: a ScrollArea around 2 rows would add a scroll
          container and its padding for nothing. The height is fixed to
          exactly VISIBLE_ROWS so the cut-off row is partly visible and the
          list reads as scrollable without needing a separate hint. */}
      {scrolls ? (
        <ScrollArea
          className="pr-3"
          style={{ height: `${VISIBLE_ROWS * ROW_HEIGHT_REM}rem` }}
        >
          {list}
        </ScrollArea>
      ) : (
        list
      )}
    </div>
  )
}

/**
 * The column is plain text, so an algorithm this build no longer offers is
 * shown as stored rather than mapped to a wrong label or hidden.
 */
function algorithmLabel(algorithm: string | null): string | null {
  if (!algorithm) return null
  return isAlgorithm(algorithm) ? ALGORITHM_LABELS[algorithm] : algorithm
}
