'use client'

import {
  Braces,
  Copy,
  Cpu,
  Database,
  FileText,
  FolderGit2,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plug,
  Trash2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import type { SavedDataset } from '@/store/datasets'
import type { DataSourceKind } from '@/lib/mock-data-sources'
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
import { Separator } from '@/components/ui/separator'

/** Per-kind lineage badge presentation (icon + short label). */
const SOURCE_META: Record<DataSourceKind, { label: string; icon: LucideIcon }> =
  {
    aveva: { label: 'AVEVA PI', icon: Cpu },
    sql: { label: 'SQL', icon: Database },
    csv: { label: 'CSV', icon: FileText },
    api: { label: 'API', icon: Plug },
  }

function Kpi({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/50 bg-muted/30 p-2.5">
      <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
        {label}
      </p>
      <p className="truncate font-mono text-sm font-medium text-foreground">
        {value}
      </p>
      {sub && <p className="text-[9px] text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

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
    <div className="group flex flex-col rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:ring-primary/50">
      {/* 1. Header — context & identity */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="truncate">{workspaceName}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <FolderGit2 className="h-5 w-5" />
            </div>
            <h3 className="truncate text-base font-semibold text-foreground">
              {d.name}
            </h3>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${d.name}`}
              className="relative cursor-pointer shrink-0 text-muted-foreground transition-opacity after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-full ">
            <DropdownMenuItem
              onClick={onEditPipeline}
              className="cursor-pointer"
            >
              <Wand2 className="mr-2 h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onViewConfig} className="cursor-pointer">
              <Braces className="h-3.5 w-3.5" />
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

      {/* 2. Data-source lineage */}
      <div className="mb-3 flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className="gap-1.5 font-medium text-foreground"
        >
          <SourceIcon className="h-3 w-3 text-primary" />
          {source?.label ?? 'Source'}
        </Badge>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {sourceName}
          {extraSources > 0 && ` +${extraSources}`}
        </span>
      </div>

      {/* 3. Mini-KPI grid — row 1: Rows/Features, row 2: Time span */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Kpi label="Rows" value={d.rowCount.toLocaleString()} />
        <Kpi label="Features" value={String(d.tags.length)} />
        <Kpi label="Time span of data" value={timeSpan} />
      </div>

      <Separator className="my-2 h-px w-full bg-border" />

      {/* 4. Footer — primary action + created date */}
      <div className="mt-auto flex items-center gap-2  border-border pt-3 ">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 w-fit"
          onClick={onViewDetails}
        >
          View Details
        </Button>
        <div className="flex flex-col gap-1">
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {d.createdBy || 'Unknown user'}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {new Date(d.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  )
}
