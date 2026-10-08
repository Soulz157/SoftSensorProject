'use client'
import { useState } from 'react'
import { Check, Copy, Cpu, Search, X } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { readModelConfig } from '@/lib/model-config'
import { useModelPreset } from '@/hooks/model/use-model-preset'

interface Props {
  workspaceId: string
  /**
   * True when the wizard already holds work that applying a preset would
   * overwrite — a typed name or a chosen dataset. Mirrors the same
   * predicate `DraftResumeSection` uses, so the two accelerators behave
   * consistently (Jakob's Law).
   */
  dirty: boolean
}

/**
 * Demoted from an always-open card to a secondary trigger opening a dialog
 * (Hick's/Miller's Law — the primary path of name → location → dataset stays
 * visually dominant). Cloning is still exactly as destructive as before —
 * `applyPreset` overwrites name, location, data source, tags and processing
 * rules — so it is now confirmed when the form already holds work, mirroring
 * `DraftResumeSection`'s dirty-confirm pattern instead of firing immediately.
 */
export function PresetPicker({ workspaceId, dirty }: Props) {
  const { models, loading, applyPreset } = useModelPreset(workspaceId)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const filtered = q
    ? models.filter(
        m =>
          m.name.toLowerCase().includes(q) ||
          (readModelConfig(m)?.description ?? '').toLowerCase().includes(q),
      )
    : models

  function requestSelect(id: string) {
    const next = id === selectedId ? '' : id
    if (!next) {
      setSelectedId('')
      return
    }
    if (dirty) {
      setPendingId(next)
      return
    }
    setSelectedId(next)
    applyPreset(next)
  }

  function confirmApply() {
    const id = pendingId
    setPendingId(null)
    if (!id) return
    setSelectedId(id)
    applyPreset(id)
    setOpen(false)
  }

  const selectedModel = models.find(m => m.id === selectedId)

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!workspaceId}
          onClick={() => setOpen(true)}
          className={cn(
            'gap-1.5',
            // ── Dark only: outline variant แทบหายไปกับ bg ของหน้า ──
            'dark:border-foreground/25 dark:bg-muted/50 dark:text-foreground',
            'dark:shadow-sm',
            'dark:hover:border-primary/50 dark:hover:bg-muted',
            'dark:disabled:border-foreground/10 dark:disabled:bg-muted/20 dark:disabled:opacity-70',
          )}
        >
          <Copy className="h-3.5 w-3.5 dark:text-primary" />
          Copy setup from a previous model
          {/* <Badge
            variant="secondary"
            className="ml-1 text-[11px] uppercase tracking-wide dark:bg-foreground/10 dark:text-foreground/70"
          >
            Optional
          </Badge> */}
        </Button>

        {/* Says why, rather than vanishing — the trigger itself is never
      hidden (Visibility of System Status). */}
        {!workspaceId && (
          <p className="text-xs text-muted-foreground dark:text-muted-foreground/90">
            Pick a workspace first to clone one of its models.
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Copy setup from a previous model</DialogTitle>
            <DialogDescription>
              Clone the data source, tags, and processing rules from a model in
              this workspace. Name and location stay empty so you create a new
              instance.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search models…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={loading || models.length === 0}
                className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:w-8"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {selectedModel && (
              <Badge
                variant="outline"
                className="flex shrink-0 items-center gap-1.5 border-primary/40 bg-primary/5 pl-2 pr-1 text-[11px] text-primary"
              >
                <Cpu className="h-3 w-3" />
                <span className="max-w-20 truncate">{selectedModel.name}</span>
                <button
                  type="button"
                  onClick={() => setSelectedId('')}
                  aria-label="Clear selected model"
                  className="-m-1.5 ml-0.5 flex h-8 w-8 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>

          {loading ? (
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              role="status"
              aria-live="polite"
            >
              <span className="sr-only">Loading models to clone…</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl bg-muted"
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : models.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Cpu className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                No models to clone yet
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No models match &quot;{query}&quot;
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map(m => {
                const isSelected = selectedId === m.id
                const desc = readModelConfig(m)?.description?.trim()
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => requestSelect(m.id)}
                    className={cn(
                      'group relative flex gap-3 rounded-xl p-3 pr-7 text-left transition-all items-start',
                      isSelected
                        ? 'ring-2 ring-primary bg-primary/5'
                        : 'ring-1 ring-border bg-card hover:bg-accent',
                    )}
                  >
                    {isSelected && (
                      <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                    )}
                    <div
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                        isSelected
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                      )}
                    >
                      <Cpu className="h-4 w-4" />
                    </div>
                    {/* Text column, not a sibling of the icon — this is what
                        kept the description on the same line as the name,
                        colliding with the absolute check badge. */}
                    <div className="min-w-0 flex-1 flex-col">
                      <p
                        className={cn(
                          'truncate text-[11px] font-semibold leading-tight',
                          isSelected ? 'text-primary' : 'text-foreground',
                        )}
                        title={m.name}
                      >
                        {m.name}
                      </p>
                      {desc ? (
                        <p
                          className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                          title={desc}
                        >
                          {desc}
                        </p>
                      ) : (
                        <p className="text-[11px] italic leading-relaxed text-muted-foreground/60">
                          No description
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmed rather than immediate, matching DraftResumeSection's own
          resume confirm — applyPreset is strictly more destructive (it also
          clears name and location), so the same guard applies here. */}
      <AlertDialog
        open={pendingId !== null}
        onOpenChange={openState => {
          if (!openState) setPendingId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clone this model&apos;s configuration?
            </AlertDialogTitle>
            <AlertDialogDescription>
              What you have entered here — the name, the selected dataset and
              any training configuration — is replaced by this model&apos;s data
              source, tags and processing rules. None of it has been saved yet,
              so it cannot be brought back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmApply}>
              Replace and clone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
