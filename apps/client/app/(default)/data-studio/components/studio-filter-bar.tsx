'use client'

import { Search, SlidersHorizontal, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { KIND_META } from '@/app/(default)/data-studio/create/components/add-connection-dialog'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import { cn } from '@/lib/utils'
import type { useDataStudio } from '@/hooks/dataset/use-data-studio'

type Studio = ReturnType<typeof useDataStudio>

type Props = Pick<
  Studio,
  | 'activeTab'
  | 'search'
  | 'setSearch'
  | 'workspaceFilter'
  | 'setWorkspaceFilter'
  | 'workspaces'
  | 'statusFilter'
  | 'setStatusFilter'
  | 'typeFilter'
  | 'setTypeFilter'
>

export function StudioFilterBar({
  activeTab,
  search,
  setSearch,
  workspaceFilter,
  setWorkspaceFilter,
  workspaces,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 md:flex-row">
      {/* Search */}
      <div className="relative w-full flex-1">
        <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 bg-background pl-9 text-sm"
          placeholder={`Search ${activeTab === 'datasets' ? 'datasets' : 'connections'}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Workspace filter */}
      <div className="w-full md:w-auto">
        <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
          <SelectTrigger className="h-9 w-full bg-background md:w-50">
            <SelectValue placeholder="All Workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workspaces</SelectItem>
            {workspaces.map(w => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Type & Status — Data Sources tab only */}
      {activeTab === 'datasources' && (
        <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:w-auto md:pb-0">
          <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
            {(['all', 'connected', 'offline'] as const).map(f => (
              <Button
                key={f}
                type="button"
                variant="ghost"
                onClick={() => setStatusFilter(f)}
                className={cn(
                  'h-8 px-3 text-xs font-medium transition-colors',
                  statusFilter === f
                    ? f === 'connected'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : f === 'offline'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-muted text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {f === 'connected' && <Wifi className="mr-1.5 h-3 w-3" />}
                {f === 'offline' && <WifiOff className="mr-1.5 h-3 w-3" />}
                {f === 'all' ? 'All' : f === 'connected' ? 'Online' : 'Offline'}
              </Button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={typeFilter !== 'all' ? 'default' : 'outline'}
                size="sm"
                className="h-9 gap-1.5 bg-background text-foreground"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                {typeFilter === 'all'
                  ? 'Type'
                  : KIND_META[typeFilter as DataSourceKind].label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">
                Filter by type
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={typeFilter}
                onValueChange={v => setTypeFilter(v as typeof typeFilter)}
              >
                <DropdownMenuRadioItem value="all" className="text-xs">
                  All types
                </DropdownMenuRadioItem>
                {(Object.keys(KIND_META) as DataSourceKind[]).map(k => {
                  const { icon: Icon, label } = KIND_META[k]
                  return (
                    <DropdownMenuRadioItem
                      key={k}
                      value={k}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
