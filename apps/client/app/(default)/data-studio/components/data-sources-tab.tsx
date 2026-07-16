'use client'

import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  Plus,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { SourceCard } from '@/app/(default)/data-studio/create/components/data-source-picker'
import type {
  StudioSource,
  useDataStudio,
} from '@/hooks/dataset/use-data-studio'
import { StatCard } from './stat-card'

type Studio = ReturnType<typeof useDataStudio>

interface Props {
  loading: Studio['loading']
  filteredSources: Studio['filteredSources']
  connectedCount: number
  offlineCount: number
  hasFilter: boolean
  onEditSource: (source: StudioSource) => void
  onDeleteSource: (id: string) => void
  onAddConnection: () => void
}

export function DataSourcesTab({
  loading,
  filteredSources,
  connectedCount,
  offlineCount,
  hasFilter,
  onEditSource,
  onDeleteSource,
  onAddConnection,
}: Props) {
  const [deleteTarget, setDeleteTarget] = useState<StudioSource | null>(null)

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="mb-2 grid grid-cols-1 gap-4  sm:grid-cols-2">
        <StatCard
          label="Online Connections"
          value={connectedCount}
          accent="emerald"
          icon={CheckCircle2}
        />
        <StatCard
          label="Offline"
          value={offlineCount}
          accent="destructive"
          icon={AlertCircle}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredSources.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
          {filteredSources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              selected={false}
              onSelect={() => {}}
              onEdit={() => onEditSource(source)}
              onDelete={() => setDeleteTarget(source)}
              multiple={false}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border bg-muted/20 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Database className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold">No connections found</p>
            <p className="mx-auto max-w-60 text-xs text-muted-foreground">
              Try adjusting your search or add a new data source.
            </p>
          </div>
          {!hasFilter && (
            <Button onClick={onAddConnection} className="mt-2 gap-1.5">
              <Plus className="h-4 w-4" /> Add Connection
            </Button>
          )}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &quot;{deleteTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the connection from Data Sources. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  onDeleteSource(deleteTarget.id)
                  toast.success('Data source deleted')
                }
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
