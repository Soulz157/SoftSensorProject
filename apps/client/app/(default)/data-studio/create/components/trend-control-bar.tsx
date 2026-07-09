'use client'

import {
  ListFilter,
  PanelBottomClose,
  PanelBottomOpen,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelectAll: () => void
  onClearAll: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TrendControlBar({
  searchQuery,
  onSearchChange,
  onSelectAll,
  onClearAll,
  sidebarOpen,
  onToggleSidebar,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <ListFilter className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-medium text-foreground">Tags</h3>

      <div className="relative max-w-64 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search tags..."
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onSelectAll}
      >
        Select All
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onClearAll}
      >
        Clear All
      </Button>

      <Button
        size="icon-sm"
        variant="outline"
        className="ml-auto cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={sidebarOpen ? 'Collapse tag sidebar' : 'Expand tag sidebar'}
        onClick={onToggleSidebar}
      >
        {sidebarOpen ? (
          <PanelBottomClose className="h-4 w-4 " />
        ) : (
          <PanelBottomOpen className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}
