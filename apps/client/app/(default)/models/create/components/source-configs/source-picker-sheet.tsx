'use client'

import { useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { Plug, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  mpSavedDataSourcesAtom,
  mpSelectedSavedSourceIdsAtom,
  type SavedDataSource,
} from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { cn } from '@/lib/utils'
import { AddConnectionDialog } from '../add-connection-dialog'
import { SourceCard } from '../data-source-picker'

type StatusFilter = 'all' | 'connected' | 'offline'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  nav: UsePipelineNavResult
}

export function SourcePickerSheet({ open, onOpenChange }: Props) {
  const [savedSources, setSavedSources] = useAtom(mpSavedDataSourcesAtom)
  const [selectedIds, setSelectedIds] = useAtom(mpSelectedSavedSourceIdsAtom)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const handleSaveSource = (newSource: SavedDataSource) => {
    setSavedSources(prev => [...prev, newSource])
    setSelectedIds(prev => [...prev, newSource.id])
  }

  const toggleSource = (id: string) =>
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id],
    )

  const filteredSources = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return savedSources.filter(s => {
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [savedSources, searchQuery, statusFilter])

  const connectedCount = savedSources.filter(
    s => s.status === 'connected',
  ).length
  const offlineCount = savedSources.filter(s => s.status === 'offline').length

  const allFilteredSelected =
    filteredSources.length > 0 &&
    filteredSources.every(s => selectedIds.includes(s.id))

  const someFilteredSelected = filteredSources.some(s =>
    selectedIds.includes(s.id),
  )

  const selectAll = () =>
    setSelectedIds(prev => [
      ...new Set([...prev, ...filteredSources.map(s => s.id)]),
    ])

  const clearAll = () =>
    setSelectedIds(prev =>
      prev.filter(id => !filteredSources.some(s => s.id === id)),
    )

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-180 flex-col sm:max-w-180">
          <SheetHeader>
            <SheetTitle>Data Sources</SheetTitle>
            <SheetDescription>
              Select connections to include in this model&apos;s tag set.
            </SheetDescription>
          </SheetHeader>

          {savedSources.length > 0 && (
            <div className="space-y-2 px-1 pt-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search sources…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Status filter + select/clear */}
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-md border border-border p-0.5">
                  {(['all', 'connected', 'offline'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStatusFilter(f)}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                        statusFilter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {f === 'all'
                        ? `All (${savedSources.length})`
                        : f === 'connected'
                          ? `Connected (${connectedCount})`
                          : `Offline (${offlineCount})`}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={
                      filteredSources.length === 0 || allFilteredSelected
                    }
                    onClick={selectAll}
                    className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    disabled={
                      filteredSources.length === 0 || !someFilteredSelected
                    }
                    onClick={clearAll}
                    className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-2 py-3">
            {savedSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Plug className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    No saved connections
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Add your first connection to get started.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Connection
                </Button>
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                  No sources match
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="grid gap-3 ">
                {filteredSources.map(source => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    selected={selectedIds.includes(source.id)}
                    onSelect={() => toggleSource(source.id)}
                    multiple
                  />
                ))}
              </div>
            )}
          </div>

          <SheetFooter className="flex-row justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add New Connection
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AddConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveSource}
      />
    </>
  )
}
