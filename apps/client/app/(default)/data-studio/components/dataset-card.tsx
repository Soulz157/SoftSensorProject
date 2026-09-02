'use client'

import {
  BarChart2,
  Braces,
  Calendar,
  Clock,
  Copy,
  Database,
  FolderGit2,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Trash2,
  User,
  Wand2,
  Activity,
} from 'lucide-react'
import type { SavedDataset } from '@/store/datasets'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import { SOURCE_META } from '@/lib/dataset-source-meta'
import { useArtifactMetadata } from '@/hooks/dataset/artifact/use-dataset-artifact-metadata'
import { artifactTimeSpanLabel } from '@/lib/dataset-stats'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  dataset: SavedDataset
  workspaceName: string
  sourceName: string
  sourceType: DataSourceKind | null
  extraSources: number
  onViewDetails: () => void
  onEditPipeline: () => void
  onViewConfig: () => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
}

export function DatasetCard({
  dataset: d,
  workspaceName,
  sourceName,
  sourceType,
  extraSources,
  onViewDetails,
  onEditPipeline,
  onViewConfig,
  onDuplicate,
  onRename,
  onDelete,
}: Props) {
  // Real artifact footer, not a synthetic reconstruction (DS-LAKE-013) — the
  // card and its own detail sheet must report the same span for the same
  // dataset, which only holds if both read the same source.
  const { metadata } = useArtifactMetadata(d.id, d.currentArtifactId)
  const timeSpan = artifactTimeSpanLabel(metadata?.startTime, metadata?.endTime)
  const source = sourceType ? SOURCE_META[sourceType] : null
  const SourceIcon = source?.icon ?? Database

  return (
    <div className="group flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-6">
      {/* Zone 1 — identity */}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <FolderGit2 className="h-5 w-5" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={onViewDetails}
            className="truncate text-left text-[15px] font-semibold text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {d.name}
          </button>
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{workspaceName}</span>
            <Badge
              variant="secondary"
              className="shrink-0 gap-1.5 font-medium text-foreground"
            >
              <SourceIcon className="h-3 w-3 text-primary" />
              {source?.label ?? 'Source'}
            </Badge>
            <span className="min-w-0 truncate">
              {sourceName}
              {extraSources > 0 && ` +${extraSources}`}
            </span>
          </div>
        </div>
      </div>

      {/* Zone 2 — metrics */}
      <div className="grid flex-1 grid-cols-3 gap-6 border-t border-border pt-4 sm:border-t-0 sm:pt-0">
        <div className="min-w-0">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <BarChart2 className="h-3 w-3" /> Rows
          </p>
          <p className="truncate font-mono text-sm font-medium text-foreground">
            {d.rowCount.toLocaleString()}
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Activity className="h-3 w-3" /> Features
          </p>
          <p className="truncate font-mono text-sm font-medium text-foreground">
            {d.tags.length}
          </p>
        </div>
        <div className="min-w-0">
          <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" /> Time span
          </p>
          <p className="truncate font-mono text-sm font-medium text-foreground">
            {timeSpan}
          </p>
        </div>
      </div>

      {/* Zone 3 — meta */}
      <div className="flex shrink-0 flex-col gap-0.5 text-[11px] text-muted-foreground sm:items-end">
        <span className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          <span className="font-mono">
            {new Date(d.createdAt).toLocaleDateString()}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <User className="h-3 w-3" />
          {d.createdBy || 'Unknown user'}
        </span>
      </div>

      {/* Zone 4 — actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${d.name}`}
            className="relative shrink-0 cursor-pointer text-muted-foreground transition-opacity after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-full">
          <DropdownMenuItem onClick={onEditPipeline} className="cursor-pointer">
            <Wand2 className="mr-2 h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onViewConfig} className="cursor-pointer">
            <Braces className="mr-2 h-3.5 w-3.5" />
            View Config
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Structural actions */}
          <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
            <Copy className="mr-2 h-3.5 w-3.5" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename} className="cursor-pointer">
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={onDelete}
            className="cursor-pointer"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
