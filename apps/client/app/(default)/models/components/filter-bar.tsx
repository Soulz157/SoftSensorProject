import { Search, Filter } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Workspace } from '@/types/models'

interface ModelsFilterBarProps {
  activeTab: string
  searchQuery: string
  setSearchQuery: (val: string) => void
  workspaceFilter: string
  setWorkspaceFilter: (val: string) => void
  runStatusFilter: string
  setRunStatusFilter: (val: string) => void
  productionStatusFilter: string
  setProductionStatusFilter: (val: string) => void
  allWorkspaces: Workspace[]
  onClearFilters: () => void
}

export function ModelsFilterBar(props: ModelsFilterBarProps) {
  const {
    activeTab,
    searchQuery,
    setSearchQuery,
    workspaceFilter,
    setWorkspaceFilter,
    runStatusFilter,
    setRunStatusFilter,
    productionStatusFilter,
    setProductionStatusFilter,
    allWorkspaces,
    onClearFilters,
  } = props

  const hasFilters =
    workspaceFilter !== 'all' ||
    runStatusFilter !== 'all' ||
    productionStatusFilter !== 'all' ||
    searchQuery

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            Filters:
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-3">
            <div className="relative min-w-50 flex-1 md:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search models..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
              <SelectTrigger className="w-45">
                <SelectValue placeholder="All Workspaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Workspaces</SelectItem>
                {allWorkspaces.map(ws => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeTab === 'run-status' ? (
              <Select
                value={runStatusFilter}
                onValueChange={setRunStatusFilter}
              >
                <SelectTrigger className="w-37.5">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="running">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Running
                    </span>
                  </SelectItem>
                  <SelectItem value="error">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Error
                    </span>
                  </SelectItem>
                  <SelectItem value="stopped">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-zinc-400" />
                      Stopped
                    </span>
                  </SelectItem>
                  <SelectItem value="initializing">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Initializing
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={productionStatusFilter}
                onValueChange={setProductionStatusFilter}
              >
                <SelectTrigger className="w-37.5">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="running">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Running
                    </span>
                  </SelectItem>
                  <SelectItem value="warning">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Warning
                    </span>
                  </SelectItem>
                  <SelectItem value="alert">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Alert
                    </span>
                  </SelectItem>
                  <SelectItem value="offline">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-zinc-400" />
                      Offline
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
