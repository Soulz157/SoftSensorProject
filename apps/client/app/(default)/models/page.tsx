'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BrainCircuit,
  ExternalLink,
  Gauge,
  Play,
  Power,
  RefreshCw,
  Server,
  StopCircle,
  Thermometer,
  XCircle,
} from 'lucide-react'

import { ModelsFilterBar } from '@/app/(default)/models/components/filter-bar'
import { ModelsPagination } from '@/app/(default)/models/components/model-pagination'
import { allWorkspaces, allModels } from '@/types/models'
import type { FlatModel } from '@/types/models'

const ITEMS_PER_PAGE = 20

function nodeTypeIcon(type: FlatModel['nodeType']) {
  if (type === 'sensor') return <Thermometer className="h-4 w-4" />
  if (type === 'controller') return <Gauge className="h-4 w-4" />
  return <Server className="h-4 w-4" />
}

function runStatusBadge(status: FlatModel['runStatus']) {
  const config = {
    running: {
      color: 'bg-emerald-500/15 text-emerald-500',
      icon: <Play className="h-3 w-3" />,
    },
    error: {
      color: 'bg-red-500/15 text-red-500',
      icon: <XCircle className="h-3 w-3" />,
    },
    stopped: {
      color: 'bg-zinc-500/15 text-zinc-400',
      icon: <StopCircle className="h-3 w-3" />,
    },
    initializing: {
      color: 'bg-blue-500/15 text-blue-400',
      icon: <RefreshCw className="h-3 w-3" />,
    },
  } as const
  const { color, icon } = config[status]
  return (
    <Badge
      variant="outline"
      className={`gap-1 border-0 text-xs font-medium ${color}`}
    >
      {icon}
      {status}
    </Badge>
  )
}

function prodStatusBadge(status: FlatModel['productionStatus']) {
  const config = {
    running: {
      color: 'bg-emerald-500/15 text-emerald-500',
      icon: <Activity className="h-3 w-3" />,
    },
    warning: {
      color: 'bg-amber-500/15 text-amber-500',
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    alert: {
      color: 'bg-red-500/15 text-red-500',
      icon: <AlertCircle className="h-3 w-3" />,
    },
    offline: {
      color: 'bg-zinc-500/15 text-zinc-400',
      icon: <Power className="h-3 w-3" />,
    },
  } as const
  const { color, icon } = config[status]
  return (
    <Badge
      variant="outline"
      className={`gap-1 border-0 text-xs font-medium ${color}`}
    >
      {icon}
      {status}
    </Badge>
  )
}

export default function ModelsPage() {
  const [activeTab, setActiveTab] = useState('run-status')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [runStatusFilter, setRunStatusFilter] = useState('all')
  const [productionStatusFilter, setProductionStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const filteredModels = useMemo(() => {
    let filtered = [...allModels]
    if (workspaceFilter !== 'all')
      filtered = filtered.filter(m => m.workspaceId === workspaceFilter)
    if (activeTab === 'run-status' && runStatusFilter !== 'all')
      filtered = filtered.filter(m => m.runStatus === runStatusFilter)
    if (activeTab === 'production-state' && productionStatusFilter !== 'all')
      filtered = filtered.filter(
        m => m.productionStatus === productionStatusFilter,
      )
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        m =>
          m.name.toLowerCase().includes(query) ||
          m.nodeName.toLowerCase().includes(query) ||
          m.workspaceName.toLowerCase().includes(query),
      )
    }
    return filtered
  }, [
    workspaceFilter,
    runStatusFilter,
    productionStatusFilter,
    searchQuery,
    activeTab,
  ])

  const totalPages = Math.ceil(filteredModels.length / ITEMS_PER_PAGE)
  const paginatedModels = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredModels.slice(start, start + ITEMS_PER_PAGE)
  }, [filteredModels, currentPage])

  const handleFilterChange =
    (setter: (val: string) => void) => (val: string) => {
      setter(val)
      setCurrentPage(1)
    }

  const clearFilters = () => {
    setWorkspaceFilter('all')
    setRunStatusFilter('all')
    setProductionStatusFilter('all')
    setSearchQuery('')
    setCurrentPage(1)
  }

  const runCounts = {
    running: filteredModels.filter(m => m.runStatus === 'running').length,
    error: filteredModels.filter(m => m.runStatus === 'error').length,
    stopped: filteredModels.filter(m => m.runStatus === 'stopped').length,
    total: filteredModels.length,
  }

  const prodCounts = {
    running: filteredModels.filter(m => m.productionStatus === 'running')
      .length,
    warning: filteredModels.filter(m => m.productionStatus === 'warning')
      .length,
    alert: filteredModels.filter(m => m.productionStatus === 'alert').length,
    offline: filteredModels.filter(m => m.productionStatus === 'offline')
      .length,
  }

  const anomalies = filteredModels.filter(m => m.anomalyCause)

  return (
    <div className="flex flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Models</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              AI Models
            </h1>
            <p className="mt-1 text-muted-foreground">
              {allModels.length} models across {allWorkspaces.length} workspaces
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90">
              <BrainCircuit className="h-4 w-4" />
              Deploy Model
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={v => {
            setActiveTab(v)
            setCurrentPage(1)
          }}
          className="flex-col space-y-6"
        >
          <TabsList className="inline-flex w-full max-w-md flex-row bg-secondary">
            <TabsTrigger
              value="run-status"
              className="gap-2 cursor-pointer data-active:bg-zinc-600 data-active:text-white"
            >
              <Play className="h-4 w-4" />
              Run Status
            </TabsTrigger>
            <TabsTrigger
              value="production-state"
              className="gap-2 cursor-pointer  data-active:bg-zinc-600 data-active:text-white"
            >
              <Activity className="h-4 w-4" />
              Production State
            </TabsTrigger>
          </TabsList>

          <ModelsFilterBar
            activeTab={activeTab}
            searchQuery={searchQuery}
            setSearchQuery={v => handleFilterChange(setSearchQuery)(v)}
            workspaceFilter={workspaceFilter}
            setWorkspaceFilter={handleFilterChange(setWorkspaceFilter)}
            runStatusFilter={runStatusFilter}
            setRunStatusFilter={handleFilterChange(setRunStatusFilter)}
            productionStatusFilter={productionStatusFilter}
            setProductionStatusFilter={handleFilterChange(
              setProductionStatusFilter,
            )}
            allWorkspaces={allWorkspaces}
            onClearFilters={clearFilters}
          />

          {/* Run Status Tab */}
          <TabsContent value="run-status" className="space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-emerald-500/50 ${runStatusFilter === 'running' ? 'ring-2 ring-emerald-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setRunStatusFilter)(
                    runStatusFilter === 'running' ? 'all' : 'running',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Running</p>
                      <p className="text-2xl font-bold text-emerald-500">
                        {runCounts.running}
                      </p>
                    </div>
                    <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
                      <Play className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-red-500/50 ${runStatusFilter === 'error' ? 'ring-2 ring-red-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setRunStatusFilter)(
                    runStatusFilter === 'error' ? 'all' : 'error',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Error</p>
                      <p className="text-2xl font-bold text-red-500">
                        {runCounts.error}
                      </p>
                    </div>
                    <div className="rounded-md bg-red-500/10 p-2 text-red-500">
                      <XCircle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-zinc-500/50 ${runStatusFilter === 'stopped' ? 'ring-2 ring-zinc-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setRunStatusFilter)(
                    runStatusFilter === 'stopped' ? 'all' : 'stopped',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Stopped</p>
                      <p className="text-2xl font-bold text-zinc-400">
                        {runCounts.stopped}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-500/10 p-2 text-zinc-400">
                      <StopCircle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total</p>
                      <p className="text-2xl font-bold text-foreground">
                        {runCounts.total}
                      </p>
                    </div>
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Activity className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Table */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">Models</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Model
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Workspace
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Node
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Resources
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Updated
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedModels.map(m => (
                        <tr
                          key={m.id}
                          className="border-b border-border/50 transition-colors hover:bg-muted/20"
                        >
                          <td className="px-4 py-3">
                            <Link href={`/models/${m.id}`} className="group">
                              <p className="font-medium text-foreground group-hover:text-primary group-hover:underline">
                                {m.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {m.version}
                              </p>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {runStatusBadge(m.runStatus)}
                            {m.errorMessage && (
                              <p className="mt-1 max-w-45 truncate text-xs text-red-400">
                                {m.errorMessage}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {m.workspaceName}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              {nodeTypeIcon(m.nodeType)}
                              <span>{m.nodeName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {m.runStatus === 'running' ? (
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                <p>CPU: {m.cpu}</p>
                                <p>Mem: {m.memory}</p>
                                <p>Lat: {m.latency}</p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {m.lastUpdated}
                          </td>
                          <td className="px-4 py-3">
                            <Link href={`/workspaces/${m.workspaceId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 text-xs"
                              >
                                <ExternalLink className="h-3 w-3" />
                                View
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {paginatedModels.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No models match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <ModelsPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </TabsContent>

          {/* Production State Tab */}
          <TabsContent value="production-state" className="space-y-6">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-emerald-500/50 ${productionStatusFilter === 'running' ? 'ring-2 ring-emerald-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setProductionStatusFilter)(
                    productionStatusFilter === 'running' ? 'all' : 'running',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Running</p>
                      <p className="text-2xl font-bold text-emerald-500">
                        {prodCounts.running}
                      </p>
                    </div>
                    <div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500">
                      <Activity className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-amber-500/50 ${productionStatusFilter === 'warning' ? 'ring-2 ring-amber-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setProductionStatusFilter)(
                    productionStatusFilter === 'warning' ? 'all' : 'warning',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Warning</p>
                      <p className="text-2xl font-bold text-amber-500">
                        {prodCounts.warning}
                      </p>
                    </div>
                    <div className="rounded-md bg-amber-500/10 p-2 text-amber-500">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-red-500/50 ${productionStatusFilter === 'alert' ? 'ring-2 ring-red-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setProductionStatusFilter)(
                    productionStatusFilter === 'alert' ? 'all' : 'alert',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Alert</p>
                      <p className="text-2xl font-bold text-red-500">
                        {prodCounts.alert}
                      </p>
                    </div>
                    <div className="rounded-md bg-red-500/10 p-2 text-red-500">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-border bg-card transition-all hover:border-zinc-500/50 ${productionStatusFilter === 'offline' ? 'ring-2 ring-zinc-500' : ''}`}
                onClick={() =>
                  handleFilterChange(setProductionStatusFilter)(
                    productionStatusFilter === 'offline' ? 'all' : 'offline',
                  )
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Offline</p>
                      <p className="text-2xl font-bold text-zinc-400">
                        {prodCounts.offline}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-500/10 p-2 text-zinc-400">
                      <Power className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Active Anomalies */}
            {anomalies.length > 0 && (
              <Card className="border-amber-500/30 bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-medium text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                    Active Anomalies ({anomalies.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {anomalies.slice(0, 5).map(m => (
                      <div
                        key={m.id}
                        className="flex items-start gap-3 rounded-md bg-muted/30 p-3"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {m.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.anomalyCause}
                          </p>
                        </div>
                      </div>
                    ))}
                    {anomalies.length > 5 && (
                      <p className="pt-1 text-xs text-muted-foreground">
                        +{anomalies.length - 5} more anomalies
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Table */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">
                  Production Models
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Model
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Workspace
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Node
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Accuracy
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Anomaly
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Updated
                        </th>
                        <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedModels.map(m => (
                        <tr
                          key={m.id}
                          className="border-b border-border/50 transition-colors hover:bg-muted/20"
                        >
                          <td className="px-4 py-3">
                            <Link href={`/models/${m.id}`} className="group">
                              <p className="font-medium text-foreground group-hover:text-primary group-hover:underline">
                                {m.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {m.version}
                              </p>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {prodStatusBadge(m.productionStatus)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {m.workspaceName}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              {nodeTypeIcon(m.nodeType)}
                              <span>{m.nodeName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {m.accuracy ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            {m.anomalyCause ? (
                              <p className="max-w-[200px] truncate text-xs text-amber-400">
                                {m.anomalyCause}
                              </p>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {m.lastUpdated}
                          </td>
                          <td className="px-4 py-3">
                            <Link href={`/workspaces/${m.workspaceId}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 text-xs"
                              >
                                <ExternalLink className="h-3 w-3" />
                                View
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {paginatedModels.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No models match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <ModelsPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
