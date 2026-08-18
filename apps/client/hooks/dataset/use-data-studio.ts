'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAtom, useSetAtom } from 'jotai'
import {
  dsSearchAtom,
  dsTypeFilterAtom,
  dsStatusFilterAtom,
} from '@/store/data-sources'
import { toast } from 'sonner'
import {
  initDatasetWizardAtom,
  initDatasetWizardForEditAtom,
} from '@/store/dataset-studio'
import type { SavedDataset } from '@/store/datasets'
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
  const { datasets, createDataset, deleteDataset, updateDataset } =
    useDatasets()

  const [activeTab, setActiveTab] = useState('datasets')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')

  const [search, setSearch] = useAtom(dsSearchAtom)
  const [typeFilter, setTypeFilter] = useAtom(dsTypeFilterAtom)
  const [statusFilter, setStatusFilter] = useAtom(dsStatusFilterAtom)
  const initDatasetWizard = useSetAtom(initDatasetWizardAtom)
  const initDatasetWizardForEdit = useSetAtom(initDatasetWizardForEditAtom)

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

  /**
   * Re-open a saved dataset in the wizard to edit ONLY its preprocessing
   * pipeline. Resolves the recipe's source ids to full source objects, hydrates
   * every `dw*` atom, and lands on Step 3. Legacy recipes (no `baseTags`) still
   * open but rebuild from the final tag list — warn the user it may differ.
   */
  const handleDatasetEdit = (dataset: SavedDataset) => {
    const sources = dataset.sourceIds
      .map(id => allSources.find(s => s.id === id))
      .filter((s): s is StudioSource => s !== undefined)

    if (!dataset.pipelineConfig.baseTags) {
      toast.warning(
        'Legacy dataset: original tags unavailable, recipe may differ',
      )
    }

    initDatasetWizardForEdit({ dataset, sources })
    router.push('/data-studio/create')
  }

  /** Clone a dataset (same sources + recipe) under a "<name> (copy)" name. */
  const handleDatasetDuplicate = async (dataset: SavedDataset) => {
    try {
      await createDataset({
        name: `${dataset.name} (copy)`,
        description: dataset.description ?? undefined,
        workspaceId: dataset.workspaceId,
        sourceIds: dataset.sourceIds,
        tags: dataset.tags,
        pipelineConfig: dataset.pipelineConfig,
        fileUrl: null,
        rowCount: dataset.rowCount,
        missingPct: dataset.missingPct,
      })
      toast.success('Dataset duplicated')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to duplicate dataset',
      )
    }
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

  /** Name + kind for a source id — feeds the dataset lineage badges. */
  const getSourceMeta = (id: string) => {
    const s = allSources.find(src => src.id === id)
    return {
      name: s?.name ?? 'Unknown source',
      type: s?.type ?? null,
    }
  }

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
    getSourceMeta,
    // dialogs
    dialogOpen,
    setDialogOpen,
    editingSource,
    setEditingSource,
    datasetDialogOpen,
    setDatasetDialogOpen,
    handleDatasetCreated,
    handleDatasetEdit,
    handleDatasetDuplicate,
  }
}
