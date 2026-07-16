'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtom, useSetAtom } from 'jotai'
import {
  dsSearchAtom,
  dsTypeFilterAtom,
  dsStatusFilterAtom,
} from '@/store/data-sources'
import { initDatasetWizardAtom } from '@/store/dataset-studio'
import { useDataSources } from '@/hooks/use-data-sources'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useDatasets } from '@/hooks/dataset/use-datasets'

/** A single connected data source, as returned by `useDataSources`. */
export type StudioSource = ReturnType<typeof useDataSources>['sources'][number]

/**
 * Owns all page state, filtering derivations, and handlers for `/data-studio`.
 * Keeps `page.tsx` a thin composition shell (per the "pages = thin shells" rule).
 * Composes the existing `useDataSources` / `useWorkspaces` / `useDatasets` hooks.
 */
export function useDataStudio() {
  const router = useRouter()

  const {
    sources: allSources,
    loading,
    refetch,
    deleteSource,
  } = useDataSources()
  const { workspaces } = useWorkspaces()
  const { datasets, deleteDataset, updateDataset } = useDatasets()

  const [activeTab, setActiveTab] = useState('datasets')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')

  const [search, setSearch] = useAtom(dsSearchAtom)
  const [typeFilter, setTypeFilter] = useAtom(dsTypeFilterAtom)
  const [statusFilter, setStatusFilter] = useAtom(dsStatusFilterAtom)
  const initDatasetWizard = useSetAtom(initDatasetWizardAtom)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<StudioSource | null>(null)

  // ── Dataset creation dialog ──
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false)

  // ── Filtering ──
  const filteredDatasets = useMemo(() => {
    const q = search.toLowerCase().trim()
    return datasets.filter(d => {
      const matchesSearch =
        !q ||
        d.name.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q)
      const matchesWorkspace =
        workspaceFilter === 'all' || d.workspaceId === workspaceFilter
      return matchesSearch && matchesWorkspace
    })
  }, [datasets, search, workspaceFilter])

  const filteredSources = useMemo(() => {
    const q = search.toLowerCase().trim()
    return allSources.filter(s => {
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.createdBy.toLowerCase().includes(q)
      const matchesType = typeFilter === 'all' || s.type === typeFilter
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter
      // `workspaceId` may not exist on every source — skip the filter when absent.
      const sourceWorkspaceId = (s as { workspaceId?: string }).workspaceId
      const matchesWorkspace =
        workspaceFilter === 'all' ||
        sourceWorkspaceId === workspaceFilter ||
        !sourceWorkspaceId
      return matchesSearch && matchesType && matchesStatus && matchesWorkspace
    })
  }, [allSources, search, typeFilter, statusFilter, workspaceFilter])

  const handleDatasetCreated = (
    name: string,
    description: string,
    workspaceId: string,
    sources: StudioSource[] = [],
  ) => {
    // Sources may be pre-selected in the dialog; any not chosen here can still
    // be added in-wizard (Step 1 → SourcePickerSheet).
    initDatasetWizard({
      name,
      description,
      workspaceId,
      sources,
    })
    setDatasetDialogOpen(false)
    router.push('/data-studio/create')
  }

  const connectedCount = allSources.filter(s => s.status === 'connected').length
  const offlineCount = allSources.length - connectedCount
  const hasFilter =
    search !== '' ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    workspaceFilter !== 'all'

  const handleClearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setStatusFilter('all')
    setWorkspaceFilter('all')
  }

  const getWorkspaceName = (id: string) =>
    workspaces.find(w => w.id === id)?.name ?? 'Unknown Workspace'

  const getSourceName = (id: string) =>
    allSources.find(s => s.id === id)?.name ?? 'Unknown source'

  return {
    // data
    allSources,
    datasets,
    workspaces,
    loading,
    refetch,
    deleteSource,
    deleteDataset,
    updateDataset,
    // tab + filters
    activeTab,
    setActiveTab,
    search,
    setSearch,
    workspaceFilter,
    setWorkspaceFilter,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    hasFilter,
    handleClearFilters,
    // derived
    filteredDatasets,
    filteredSources,
    connectedCount,
    offlineCount,
    getWorkspaceName,
    getSourceName,
    // dialogs
    dialogOpen,
    setDialogOpen,
    editingSource,
    setEditingSource,
    datasetDialogOpen,
    setDatasetDialogOpen,
    handleDatasetCreated,
  }
}
