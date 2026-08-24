'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { featureColumnName } from '@/lib/feature-engineering'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { cn } from '@/lib/utils'
import {
  useDatasetTagTable,
  type DatasetTagRow,
} from '@/hooks/dataset/use-dataset-tag-table'
import {
  tagKey,
  sourceIdOf,
  tagNameOf,
  type TagQuality,
} from '@/hooks/dataset/use-dataset-tag-metadata'
import {
  useDatasetTagSearch,
  MAX_NAMES,
} from '@/hooks/dataset/use-dataset-tag-search'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import {
  dwFeaturePresetAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagKeysAtom,
  dwTagUnitOverridesAtom,
  dwTagUnitsAtom,
  dwTargetTagAtom,
  presetRangeCandidatesFromDocument,
} from '@/store/dataset-studio'
import { planPresetApplication } from '@/lib/feature-preset'
import { useStageSdtaPreset } from '@/hooks/use-sdta-preset'
import { SourcePickerSheet } from './source-configs/source-picker-sheet'
import { PresetApplyManager } from './preset-apply-modal'
import {
  MAX_PATTERNS,
  PATTERN_CAP,
} from '@/hooks/dataset/use-multi-pattern-search'

const PAGE_SIZE = 100

const QUALITY_META: Record<
  TagQuality,
  { label: string; dot: string; text: string }
> = {
  good: {
    label: 'Good',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  questionable: {
    label: 'Questionable',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  bad: {
    label: 'Bad',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
  unknown: {
    label: '—',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
}

function QualityBadge({ quality }: { quality: TagQuality }) {
  const q = QUALITY_META[quality]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-medium',
        q.text,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', q.dot)} />
      {q.label}
    </span>
  )
}

/**
 * PI snapshot time → compact local `yyyy-MM-dd HH:mm`. The raw ISO string stays
 * in the cell's `title`. Backend sends UTC with a `Z`, so `new Date()` converts
 * to browser-local correctly — the column header says "(local)".
 */
function formatSnapshotTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'yyyy-MM-dd HH:mm')
}

function BoolCell({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={
        value ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
      }
    >
      {value ? 'Yes' : 'No'}
    </span>
  )
}

type StatusFilter = 'all' | 'good' | 'bad'

interface Props {
  nav: UseDatasetPipelineNavResult
}

/**
 * Refresh lives in the main toolbar, NOT here: it re-reads snapshot quality for
 * the whole page, which goes stale on its own clock regardless of what is
 * selected. Gating it behind a selection made it unreachable exactly when the
 * numbers on screen were oldest.
 */
function BulkActionBar({
  count,
  visibleCount,
  onClear,
  onDeleteClick,
}: {
  count: number
  visibleCount: number
  onClear: () => void
  onDeleteClick: () => void
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 animate-in fade-in-0 slide-in-from-top-1">
      <span className="text-xs font-medium text-foreground">
        {count} tag{count === 1 ? '' : 's'} selected
        {/* Selection survives paging — without this the count looks wrong
            whenever it exceeds the rows on screen. */}
        {count > visibleCount && (
          <span className="ml-1 font-normal text-muted-foreground">
            ({visibleCount} on this page)
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
        Clear selection
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDeleteClick}
          disabled={visibleCount === 0}
          title={
            count > visibleCount
              ? 'Only tags on this page can be deleted'
              : undefined
          }
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}

function ConstantValueInput({
  value,
  onCommit,
}: {
  value: number | undefined
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')

  useEffect(() => {
    setDraft(value?.toString() ?? '')
  }, [value])

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder="Set value"
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') {
          onCommit(null)
          return
        }
        const n = Number(raw)
        if (!Number.isNaN(n)) onCommit(n)
      }}
      className="h-7 w-24 bg-transparent font-mono text-xs text-foreground outline-none"
    />
  )
}

/**
 * Fills the Unit cell only for a tag Step 1 can't auto-detect one for
 * (CSV/manual, or a PI tag whose metadata omits it) — see `dwTagUnitOverridesAtom`.
 * A PI-reported unit stays a plain read-only span; this never renders for it.
 */
function UnitOverrideInput({
  value,
  onCommit,
}: {
  value: string | undefined
  onCommit: (v: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => {
    setDraft(value ?? '')
  }, [value])

  return (
    <Input
      type="text"
      value={draft}
      placeholder="Set unit"
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        const trimmed = raw.trim()
        onCommit(trimmed === '' ? null : trimmed)
      }}
      className="h-7 w-16 bg-transparent font-mono text-xs text-foreground outline-none"
    />
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function UnifiedTagTable({ nav }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const debouncedSearch = useDebounced(searchQuery, 300)
  // Step 1 has no fetched rows to plan a health-aware cut against, so
  // pressing Apply on the SD&TA card here STAGES the config rather than
  // planning it — the real plan happens in Step 3.2's `SdtaPresetCard`,
  // against real data (DS-LAKE-013).
  const stageSdta = useStageSdtaPreset()

  /**
   * One search box, two modes (see `lib/tag-search.ts`):
   * - a bare fragment → paginated wildcard search on PI
   * - names separated by commas → one `/pi/tags/resolve` call, no paging.
   *   This is the only way to look up several tags at once when they sit on
   *   different catalog pages.
   */
  const {
    mode,
    metaByTag,
    tagsBySource,
    notFound,
    droppedNames,
    truncatedPatterns,
    emptyPatterns,
    droppedPatterns,
    hasNextBySource,
    pageBySource,
    goto,
    refetch: refetchMeta,
    loading: metaLoading,
    error: metaError,
  } = useDatasetTagSearch(debouncedSearch, PAGE_SIZE)

  const {
    rows,
    deleteRow,
    renameRow,
    addRow,
    uploadCompare,
    isConstantEditable,
    getConstant,
    setConstant,
  } = useDatasetTagTable(nav, tagsBySource)

  const sources = useAtomValue(dwSelectedSourcesAtom)
  const piSources = useMemo(
    () => sources.filter(s => s.type === 'aveva'),
    [sources],
  )
  const piSourceIdsKey = JSON.stringify(piSources.map(s => s.id))

  const setFeaturePreset = useSetAtom(dwFeaturePresetAtom)
  const setTagUnits = useSetAtom(dwTagUnitsAtom)
  const [tagUnitOverrides, setTagUnitOverrides] = useAtom(
    dwTagUnitOverridesAtom,
  )
  const setUnitOverride = useCallback(
    (tagName: string, unit: string | null) => {
      setTagUnitOverrides(prev => {
        if (unit === null) {
          if (!(tagName in prev)) return prev
          const { [tagName]: _omit, ...rest } = prev
          return rest
        }
        if (prev[tagName] === unit) return prev
        return { ...prev, [tagName]: unit }
      })
    },
    [setTagUnitOverrides],
  )
  const setPresetRange = useSetAtom(dwPresetRangeAtom)
  const setPresetRangeStale = useSetAtom(dwPresetRangeStaleAtom)
  // Read as well as write: the same atom the preset path below writes is what
  // marks the row here, so the two entry points cannot disagree on which tag
  // is Y. It stores a bare tag NAME, never a selection key — every reader
  // compares names (step-5-review-save against the artifact's own tag list,
  // dataset-tag-sidebar against the frame) and it reaches Python as the
  // `target_y` column name.
  const [targetTag, setTargetTag] = useAtom(dwTargetTagAtom)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const compareFileRef = useRef<HTMLInputElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  /**
   * Collapses two independent dimensions into the one the UI shows:
   *   row.status  — is the tag usable at all (name wrong / not in historian)
   *   meta.quality — is the last reading trustworthy
   * A tag can be `status: 'good'` with a Bad reading, which is the common plant
   * case. Counting only `row.status` is what made the pill read "Bad (0)" while
   * the table showed Bad rows.
   */
  const getEffectiveStatus = useCallback(
    (row: DatasetTagRow): 'good' | 'bad' => {
      if (row.status === 'bad') return 'bad'
      if (row.sourceId) {
        const meta = metaByTag.get(tagKey(row.sourceId, row.originalName))
        if (meta?.quality === 'bad') return 'bad'
      }
      return 'good'
    },
    [metaByTag],
  )

  // ── Selection ────────────────────────────────────────────────────────────
  // Keyed by `${sourceId}::${tagName}`, not row id. Row ids only exist for the
  // page currently loaded, so an id-keyed set was silently dropped on every
  // page change — the user's picks vanished and Step 2 fetched the wrong set.
  const [selectedKeys, setSelectedKeys] = useAtom(dwSelectedTagKeysAtom)

  const rowKey = useCallback(
    (r: DatasetTagRow) =>
      r.sourceId ? tagKey(r.sourceId, r.originalName) : `manual::${r.id}`,
    [],
  )

  const isSelected = useCallback(
    (r: DatasetTagRow) => selectedKeys.has(rowKey(r)),
    [selectedKeys, rowKey],
  )

  const toggleRow = (r: DatasetTagRow) =>
    setSelectedKeys(prev => {
      const next = new Set(prev)
      const k = rowKey(r)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const clearSelection = () => setSelectedKeys(new Set())

  // ── Target (Y) ───────────────────────────────────────────────────────────
  // Engineered columns exist in the client frame the moment their equation is
  // queued, but NOT in the stored artifact until the feature job has run.
  // Naming one as Y fails inside pyarrow with `No match for FieldRef.Name` at
  // run creation — nowhere a user could act on it — so they are refused here
  // instead. Mirrors `dataset-tag-sidebar.tsx`'s own engineered-name set.
  const engineeredNames = useMemo(
    () => new Set(nav.featureConfigs.map(featureColumnName)),
    [nav.featureConfigs],
  )

  const isTargetRow = useCallback(
    (r: DatasetTagRow) => targetTag !== null && r.tagName === targetTag,
    [targetTag],
  )

  /**
   * Exactly one target comes for free — the atom holds a single string, so a
   * new pick replaces the previous one with no clearing pass, and the UI
   * cannot build the multi-target state the run-creation endpoint rejects.
   */
  const toggleTarget = useCallback(
    (r: DatasetTagRow) => {
      if (engineeredNames.has(r.tagName)) return
      if (isTargetRow(r)) {
        setTargetTag(null)
        return
      }
      setTargetTag(r.tagName)
      // A target has to be in the fetch to reach the artifact at all. Mirrors
      // what the preset path already does (`planPresetApplication` unions the
      // resolved target into its selection keys), and goes through the
      // selection atom for the reason `onApplyPreset` spells out below.
      setSelectedKeys(prev => {
        const k = rowKey(r)
        return prev.has(k) ? prev : new Set(prev).add(k)
      })
    },
    [engineeredNames, isTargetRow, setTargetTag, setSelectedKeys, rowKey],
  )

  // Prune by source, not by row set: a key whose source is still selected is
  // valid even when its tag sits on a page we haven't loaded.
  useEffect(() => {
    const live = new Set(piSources.map(s => s.id))
    setSelectedKeys(prev => {
      const next = new Set(
        [...prev].filter(k => {
          const sid = sourceIdOf(k)
          return sid === 'manual' || live.has(sid)
        }),
      )
      // Bail out on no-op: a fresh Set every time re-renders forever if `rows`
      // upstream isn't memoised.
      return next.size === prev.size ? prev : next
    })
  }, [piSourceIdsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const { setSelectedTags, setHasInvalidTags } = nav

  const selectedTagNames = useMemo(() => {
    const byKey = new Map(rows.map(r => [rowKey(r), r]))
    const names = new Set<string>()
    for (const key of selectedKeys) {
      const row = byKey.get(key)
      if (row) {
        if (getEffectiveStatus(row) === 'good') names.add(row.tagName)
        continue
      }
      // Not on this page. PI keys carry the tag name, and anything that came
      // out of the catalogue exists in the historian.
      if (sourceIdOf(key) !== 'manual') names.add(tagNameOf(key))
    }
    return [...names].sort()
  }, [selectedKeys, rows, rowKey, getEffectiveStatus])

  useEffect(() => {
    const same =
      nav.selectedTags.length === selectedTagNames.length &&
      nav.selectedTags.every((t, i) => t === selectedTagNames[i])
    // setSelectedTags resets the downstream fetch — only call on a real change.
    if (!same) setSelectedTags(selectedTagNames)
  }, [selectedTagNames, nav.selectedTags, setSelectedTags])

  /**
   * DS-LAKE-020-T03: snapshot each selected tag's engineering unit while
   * `metaByTag` (hook-local, dies with this component) is still populated —
   * otherwise Step 3.2's range-cutoff unit gate has no unit to reconcile
   * against. A tag not on the currently loaded page, or with no PI record at
   * all (manual/CSV), snapshots as `null` — a real absence, not a stale
   * value, since a later resolve only ever adds entries.
   *
   * `tagUnitOverrides` fills that gap for a tag with no PI-reported unit — a
   * user-entered unit from the Unit cell's editable fallback. The
   * PI-reported value always wins when both exist; the override only ever
   * covers a `null`.
   */
  const selectedTagUnits = useMemo(() => {
    const byKey = new Map(rows.map(r => [rowKey(r), r]))
    const units: Record<string, string | null> = {}
    for (const key of selectedKeys) {
      const row = byKey.get(key)
      if (row) {
        if (getEffectiveStatus(row) !== 'good') continue
        const meta = row.sourceId
          ? metaByTag.get(tagKey(row.sourceId, row.originalName))
          : undefined
        units[row.tagName] = meta?.unit ?? tagUnitOverrides[row.tagName] ?? null
        continue
      }
      if (sourceIdOf(key) !== 'manual') {
        units[tagNameOf(key)] = tagUnitOverrides[tagNameOf(key)] ?? null
      }
    }
    return units
  }, [
    selectedKeys,
    rows,
    rowKey,
    getEffectiveStatus,
    metaByTag,
    tagUnitOverrides,
  ])

  useEffect(() => {
    setTagUnits(prev => {
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(selectedTagUnits)
      const same =
        prevKeys.length === nextKeys.length &&
        nextKeys.every(k => prev[k] === selectedTagUnits[k])
      return same ? prev : selectedTagUnits
    })
  }, [selectedTagUnits, setTagUnits])

  useEffect(() => {
    setHasInvalidTags(
      rows.some(r => getEffectiveStatus(r) === 'bad' && isSelected(r)),
    )
  }, [rows, isSelected, setHasInvalidTags, getEffectiveStatus])

  // ── Filtering ────────────────────────────────────────────────────────────
  const searchedRows = useMemo(() => {
    // In names mode every row IS a name the user asked for. Re-filtering by the
    // raw input would drop all of them, because the input contains the commas
    // that split it in the first place.
    if (mode === 'names') return rows
    const q = searchQuery.toLowerCase().trim()
    if (!q) return rows
    return rows.filter(r => r.tagName.toLowerCase().includes(q))
  }, [rows, searchQuery, mode])

  // Counts read the SEARCH layer, not `filteredRows`: reading the filtered set
  // would make each pill's number change in response to its own click.
  const goodCount = useMemo(
    () => searchedRows.filter(r => getEffectiveStatus(r) === 'good').length,
    [searchedRows, getEffectiveStatus],
  )

  const badCount = useMemo(
    () => searchedRows.filter(r => getEffectiveStatus(r) === 'bad').length,
    [searchedRows, getEffectiveStatus],
  )

  const filteredRows = useMemo(() => {
    const base =
      statusFilter === 'all'
        ? searchedRows
        : searchedRows.filter(r => getEffectiveStatus(r) === statusFilter)
    // Selected tags float to the top of this page — a source page is fetched
    // PAGE_SIZE rows at a time, so a tag picked earlier (e.g. via a preset)
    // could otherwise sit off-screen below the fold on its own page. The
    // target outranks them for the same reason: there is only ever one.
    return [...base].sort(
      (a, b) =>
        Number(isTargetRow(b)) - Number(isTargetRow(a)) ||
        Number(isSelected(b)) - Number(isSelected(a)),
    )
  }, [searchedRows, statusFilter, getEffectiveStatus, isSelected, isTargetRow])

  const selectedRows = useMemo(
    () => rows.filter(isSelected),
    [rows, isSelected],
  )
  const selectedCount = selectedKeys.size
  const visibleSelectedCount = selectedRows.length

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every(isSelected)
  const someFilteredSelected =
    filteredRows.some(isSelected) && !allFilteredSelected

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someFilteredSelected
    }
  }, [someFilteredSelected])

  const toggleAllFiltered = () =>
    setSelectedKeys(prev => {
      const next = new Set(prev)
      for (const r of filteredRows) {
        if (allFilteredSelected) next.delete(rowKey(r))
        else next.add(rowKey(r))
      }
      return next
    })

  const handleAddRow = useCallback(() => {
    const newId = addRow()
    setEditingId(newId)
    setEditValue('')
  }, [addRow])

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  const startEdit = useCallback((row: DatasetTagRow) => {
    setEditingId(row.id)
    setEditValue(row.tagName)
  }, [])

  const commitEdit = useCallback(
    (row: DatasetTagRow) => {
      const wasTarget = isTargetRow(row)
      renameRow(row, editValue)
      setEditingId(null)
      // Follow the rename. The target is stored by NAME, so leaving the old
      // one behind orphans it silently — the user would only find out at Step
      // 5, as "target is not in this dataset". Guard mirrors renameRow's own
      // no-op condition exactly, or a rejected rename would retarget anyway.
      const trimmed = editValue.trim()
      if (wasTarget && trimmed !== '' && trimmed !== row.originalName) {
        setTargetTag(trimmed)
      }
    },
    [editValue, renameRow, isTargetRow, setTargetTag],
  )

  const cancelEdit = useCallback(() => setEditingId(null), [])

  // Only rows on the loaded page can be deleted — deleteRow needs the row
  // object. Drop just those keys rather than clearing the whole selection,
  // which would discard picks made on other pages.
  const bulkDelete = () => {
    const removed = selectedRows.map(rowKey)
    // Deleting the target's own row leaves the atom pointing at a tag the
    // dataset no longer has — same orphan the rename path guards against.
    if (selectedRows.some(isTargetRow)) setTargetTag(null)
    selectedRows.forEach(deleteRow)
    setSelectedKeys(prev => {
      const next = new Set(prev)
      for (const k of removed) next.delete(k)
      return next
    })
    setConfirmDeleteOpen(false)
  }

  // Was a bare setTimeout + success toast that fetched nothing. Snapshot
  // quality drives operational judgement, so it has to be a real read.
  const handleRefresh = () => {
    if (revalidating) return
    setRevalidating(true)
    refetchMeta()
  }

  useEffect(() => {
    if (!revalidating || metaLoading) return
    // One tick of slack: if refetch never flips `loading`, nothing was actually
    // fetched, and firing the toast in the same frame would be the fake-success
    // bug again in a different disguise.
    const t = setTimeout(() => {
      setRevalidating(false)
      if (!metaError) toast.success('Snapshot quality updated')
    }, 0)
    return () => clearTimeout(t)
  }, [metaLoading, revalidating, metaError])

  const isSearching = debouncedSearch.trim().length > 0

  const paginationBar =
    mode === 'wildcard' && piSources.length > 0 ? (
      <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2">
        {piSources.map(s => {
          const page = pageBySource.get(s.id) ?? 1
          const hasNext = hasNextBySource.get(s.id) === true
          const label = (s as { name?: string }).name ?? s.id
          return (
            <div key={s.id} className="flex items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{label}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2"
                  disabled={page <= 1 || metaLoading}
                  onClick={() => goto(s.id, page - 1)}
                >
                  <ChevronLeft className="h-3 w-3" />
                  Prev
                </Button>
                {/* PI Web API returns no total count, so "of N" isn't
                    available — only whether another page exists. */}
                <span className="px-1 tabular-nums text-muted-foreground">
                  Page {page}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-2"
                  disabled={!hasNext || metaLoading}
                  onClick={() => goto(s.id, page + 1)}
                >
                  Next
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    ) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-45 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search PI · AI*, FIC* · or paste full tag names"
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

        {/* Status filter pills */}
        <div className="flex items-center rounded-md border border-border p-0.5">
          {(['all', 'good', 'bad'] as const).map(f => (
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
                ? `All (${searchedRows.length})`
                : f === 'good'
                  ? `Good (${goodCount})`
                  : `Bad (${badCount})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={toggleAllFiltered}
          className="cursor-pointer gap-1.5"
        >
          {allFilteredSelected ? 'Deselect page' : 'Select page'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRow}
          className="cursor-pointer gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add New Tag
        </Button>

        <input
          ref={compareFileRef}
          type="file"
          accept=".csv,text/csv"
          className="cursor-pointer hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              uploadCompare(file)
              e.target.value = ''
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => compareFileRef.current?.click()}
          className="cursor-pointer gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload CSV
        </Button>

        {/* Rows, not tag names: the preset gate needs each row's status, and a
            `string[]` cannot tell a healthy tag from one in error. */}
        <PresetApplyManager
          rows={rows}
          onApplyPreset={applied => {
            const { document, summary, featureConfigs, comparison, resolved } =
              applied

            // Appended, not replaced: Apply Preset lives in Step 1, well before
            // Step 4 is normally visited, but a preset should augment manually
            // authored features, not silently discard them.
            nav.setFeatureConfigs(prev => [...prev, ...featureConfigs])

            // Mirrors Step 4's own `addFeature` two-part write
            // (step-4-feature-engineering.tsx) — without this, a preset's
            // equation columns are queued in featureConfigs but silently
            // absent from selectedColumns once the user has touched Step 4's
            // selection panel (selectedColumns !== null), so `select_columns`
            // server-side drops exactly the columns the preset just added.
            if (nav.selectedColumns !== null) {
              const newCols = featureConfigs
                .map(featureColumnName)
                .filter(col => !nav.selectedColumns!.includes(col))
              if (newCols.length > 0) {
                nav.setSelectedColumns([...nav.selectedColumns, ...newCols])
              }
            }

            // Write through the selection atom, NOT nav.setSelectedTags: the
            // sync effect derives nav.selectedTags from selectedKeys and would
            // overwrite a direct write on the next render, reverting the preset.
            const plan = planPresetApplication(document, comparison, resolved)
            setSelectedKeys(prev => {
              const next = new Set(prev)
              for (const k of plan.selectionKeys) next.add(k)
              return next
            })
            setTargetTag(plan.targetTag)
            setFeaturePreset(summary)

            // DS-LAKE-020-T05: snapshot per-tag range proposals now — `document`
            // (the only thing carrying `range_parsed`) is otherwise discarded the
            // instant this callback returns; only `summary` above survives.
            // `equation` features are excluded: the derived column does not
            // exist until Step 4, so their range cannot be applied here.
            // Mapping lives in `presetRangeCandidatesFromDocument` — Step
            // 3.1's edit-mode-only Apply Preset button needs the identical
            // logic and shares this one implementation.
            const rangeCandidates = presetRangeCandidatesFromDocument(document)
            setPresetRange(prev => [
              ...prev.filter(c => c.presetId !== document.preset_id),
              ...rangeCandidates,
            ])
            // A genuinely fresh (schema_version 2) document always populates
            // range_parsed on every feature — the worst case is kind:'none',
            // never null. So this bit distinguishes "predates range-cutoff
            // support" from "nothing to propose" for Step 3.2's own message.
            setPresetRangeStale(document.schema_version < 2)

            if (plan.unselectable.length > 0) {
              toast.warning(
                `Applied ${document.name}, but ${plan.unselectable.length} tag(s) have no PI source: ` +
                  plan.unselectable.join(', '),
              )
            } else {
              toast.success(
                `Applied ${document.name}. ${plan.selectionKeys.length} tag(s) selected, ` +
                  `${featureConfigs.length} equation(s) queued for Step 4.`,
              )
            }
          }}
          onApplySdta={(sdta, summary, importFileName) => {
            // Toasts live inside the hook — it knows the staging verdict
            // ('empty' / 'staged' / 'replaced'), which this callback cannot
            // see, and no `nav.set*` writes happen here at all: nothing is
            // cut until the user picks a combine mode and presses Apply in
            // Step 3.2's card.
            stageSdta(sdta, summary, importFileName)
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSourcePickerOpen(true)}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Data Sources
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={revalidating || metaLoading}
          title="Re-read snapshot quality from PI"
          className="cursor-pointer gap-1.5"
        >
          {revalidating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>

        {metaLoading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {mode === 'names'
              ? 'Checking names against PI…'
              : mode === 'patterns'
                ? 'Searching patterns in PI…'
                : 'Loading tag metadata…'}
          </span>
        )}

        {!metaLoading && metaError && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {metaError}
          </span>
        )}

        {/* Distinct from metaError on purpose: `error` means "could not check",
            these mean "checked, and this is the answer". */}
        {mode === 'names' && !metaLoading && notFound.length > 0 && (
          <span
            title={notFound.join(', ')}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {notFound.length} name{notFound.length === 1 ? '' : 's'} not in PI
          </span>
        )}

        {mode === 'patterns' &&
          !metaLoading &&
          truncatedPatterns.length > 0 && (
            <span
              title={truncatedPatterns.join(', ')}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {truncatedPatterns.length} pattern(s) hit the {PATTERN_CAP}-tag
              limit — narrow them to see the rest
            </span>
          )}

        {mode === 'patterns' && !metaLoading && emptyPatterns.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            No matches for {emptyPatterns.join(', ')}
          </span>
        )}

        {droppedNames > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            {droppedNames} name(s) over the {MAX_NAMES} limit were not checked
          </span>
        )}

        {droppedPatterns.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            Only the first {MAX_PATTERNS} patterns were searched
          </span>
        )}
      </div>

      {selectedCount > 0 && (
        <BulkActionBar
          count={selectedCount}
          visibleCount={visibleSelectedCount}
          onClear={clearSelection}
          onDeleteClick={() => setConfirmDeleteOpen(true)}
        />
      )}

      {/* No target picked yet. Someone who has not built a soft sensor before
          has no way to guess that one column must be singled out as the thing
          being predicted, or that naming it REMOVES it from the inputs — the
          Target button alone cannot say that, and its tooltip only appears if
          you already suspected it was worth hovering.

          Neutral surface + icon, never amber/red: not knowing yet is a normal
          starting state, not a fault, and those colours are reserved for plant
          operating state (DESIGN.md §2). Mutually exclusive with the warning
          below — that one needs a target to already be set. */}
      {rows.length > 0 && targetTag === null && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-foreground">
              No target (Y) chosen yet
            </p>
            <p className="text-muted-foreground">
              The target is the single tag the model learns to predict — usually
              a lab result or quality number you want estimated live. Press the{' '}
              <Target className="inline h-3 w-3 -translate-y-px text-muted-foreground" />{' '}
              next to a tag&apos;s checkbox to name it. It is excluded from the
              input features, and you can save this dataset without one.
            </p>
          </div>
        </div>
      )}

      {/* `selectedTagNames` IS the set that gets fetched — it already drops
          unselected and Bad-status rows and understands keys from pages that
          are not loaded, so this also covers a preset-set `.lab` target with
          no row on screen. */}
      {targetTag && !selectedTagNames.includes(targetTag) && (
        // Loud through placement + icon, not colour: amber/red are reserved
        // for plant operating state (DESIGN.md §2), and a target that is not
        // in the fetch is a data-workflow state, not one. Deliberately NOT
        // blocking — assembling X now and joining lab Y later is a legitimate
        // workflow, the same call step-5-review-save.tsx makes.
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-foreground">
              Target <span className="font-mono">{targetTag}</span> is not in
              this dataset
            </p>
            <p className="text-muted-foreground">
              This dataset can be saved, but it cannot train a model until the
              target is supplied — typically by CSV upload or lab ingestion.
            </p>
          </div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            {mode === 'names'
              ? 'None of those names are in PI'
              : isSearching
                ? 'No tags match in PI'
                : 'No tags yet'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mode === 'names'
              ? `Checked ${notFound.length} name(s) against the historian.`
              : isSearching
                ? `Nothing in the historian matched “${debouncedSearch.trim()}”.`
                : 'Tags are discovered from the data sources you selected for this dataset.'}
          </p>
          {isSearching && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-1 text-xs text-primary hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No tags match
          </p>

          <button
            type="button"
            onClick={() => {
              setSearchQuery('')
              setStatusFilter('all')
            }}
            className="mt-1 text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {/* Widened from w-10: this column now carries the target (Y)
                    toggle beside the checkbox. Left-aligned rather than
                    centred so the header checkbox lines up with the rows'. */}
                <TableHead className="w-20 pl-4">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    disabled={filteredRows.length === 0}
                    title="Select all visible tags"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </TableHead>
                <TableHead className="pl-2">Tag Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Data Source</TableHead>
                <TableHead className="w-16">Value</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                <TableHead className="w-16 text-center">Quest.</TableHead>
                <TableHead className="w-16 text-center">Subst.</TableHead>
                <TableHead className="w-40">Timestamp (local)</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24 pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => {
                // metaByTag is keyed `${sourceId}::${tagName}` — tag names
                // repeat across plants, so a name-only lookup both collided
                // and missed every row. Manual/CSV rows have no PI metadata.
                const meta = row.sourceId
                  ? metaByTag.get(tagKey(row.sourceId, row.originalName))
                  : undefined

                const isTarget = isTargetRow(row)
                const isEngineered = engineeredNames.has(row.tagName)

                return (
                  <TableRow
                    key={row.id}
                    // Background tint, not a left accent stripe — DESIGN.md
                    // §"Don't" calls stripes SCADA chrome and names a tint as
                    // the replacement.
                    className={cn(isTarget && 'bg-primary/5')}
                  >
                    {/* Row selection + target (Y). The two sit together on
                        purpose: both answer the same question — what part does
                        this tag play in the model — where the Actions column
                        is for operations ON the row (rename, remove). Setting
                        a target also ticks the checkbox (see toggleTarget), so
                        keeping them adjacent makes that side effect visible
                        instead of happening in a column two metres away. */}
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected(row)}
                          onChange={() => toggleRow(row)}
                          aria-label={`Select ${row.tagName}`}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary"
                        />
                        <button
                          type="button"
                          disabled={isEngineered}
                          aria-pressed={isTarget}
                          aria-label={
                            isTarget
                              ? `Clear ${row.tagName} as target`
                              : `Set ${row.tagName} as target`
                          }
                          title={
                            isEngineered
                              ? `${row.tagName} is an engineered feature — it does not exist in the stored artifact until the feature job runs, so training cannot find the column. Choose a source tag as the target.`
                              : isTarget
                                ? 'Clear target (Y)'
                                : 'Set as target (Y) — the tag the model predicts'
                          }
                          onClick={() => toggleTarget(row)}
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                            isEngineered
                              ? 'cursor-not-allowed text-muted-foreground/40'
                              : isTarget
                                ? 'text-primary hover:bg-primary/10'
                                : 'cursor-pointer text-muted-foreground/50 hover:bg-muted hover:text-primary',
                          )}
                        >
                          <Target className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>

                    {/* Tag Name — inline editable */}
                    <TableCell className="pl-2 font-mono text-xs">
                      {editingId === row.id ? (
                        <input
                          ref={editInputRef}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit(row)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          onBlur={() => commitEdit(row)}
                          className="w-full rounded border border-primary bg-transparent px-2 py-0.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'truncate',
                              getEffectiveStatus(row) === 'bad' &&
                                'text-destructive',
                            )}
                            title={row.tagName}
                          >
                            {row.tagName}
                          </span>
                          {/* The checkbox already means "include as an input".
                              This says the column is Y — train.py drops it
                              from X — so the two must not read alike. Uses
                              `primary`, never a status colour: red/amber/
                              green/grey are reserved for plant operating
                              state (DESIGN.md §2). */}
                          {isTarget && (
                            <span
                              title="Target (Y) — excluded from the input features"
                              className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                            >
                              Y
                            </span>
                          )}
                        </div>
                      )}
                      {/* Manual/CSV tags carry a user-set constant instead of a
                          live reading. */}
                      {isConstantEditable(row) && editingId !== row.id && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            Constant
                          </span>
                          <ConstantValueInput
                            value={getConstant(row)}
                            onCommit={v => setConstant(row, v)}
                          />
                        </div>
                      )}
                    </TableCell>

                    {/* Description */}
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      <span title={meta?.description ?? undefined}>
                        {meta?.description ?? '—'}
                      </span>
                    </TableCell>

                    {/* Data Source */}
                    <TableCell className="text-xs text-muted-foreground">
                      {row.dataSource}
                    </TableCell>

                    {/* Value (snapshot) */}
                    <TableCell className="text-xs text-muted-foreground">
                      {meta?.value ?? '—'}
                    </TableCell>

                    {/* Unit — read-only when PI reports one, otherwise an
                        editable fallback so a CSV/manual tag (or a PI tag
                        with no unit in its metadata) can still feed the
                        Step 3.2 range-cutoff unit gate. */}
                    <TableCell className="text-xs text-muted-foreground">
                      {meta?.unit ?? (
                        <UnitOverrideInput
                          value={tagUnitOverrides[row.tagName]}
                          onCommit={unit => setUnitOverride(row.tagName, unit)}
                        />
                      )}
                    </TableCell>

                    {/* Questionable */}
                    <TableCell className="text-center text-xs">
                      <BoolCell value={meta?.questionable} />
                    </TableCell>

                    {/* Substituted */}
                    <TableCell className="text-center text-xs">
                      <BoolCell value={meta?.substituted} />
                    </TableCell>

                    {/* Timestamp — when this snapshot value was read from PI */}
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      <span title={meta?.timestamp ?? undefined}>
                        {formatSnapshotTime(meta?.timestamp)}
                      </span>
                    </TableCell>

                    {/* Status — PI snapshot quality when the tag resolved. A
                        tag with no metadata keeps its own error state, so "not
                        found in historian" is never masked as unknown. */}
                    <TableCell>
                      {meta ? (
                        <QualityBadge quality={meta.quality} />
                      ) : (
                        <span
                          title={row.errorReason}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            row.status === 'good'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              row.status === 'good'
                                ? 'bg-muted-foreground/40'
                                : 'bg-rose-500',
                            )}
                          />
                          {row.status === 'good' ? 'No data' : 'Error'}
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="pr-4">
                      {/* Target (Y) moved out of here to sit beside the row
                          checkbox — this column is for operations ON the row. */}
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Rename tag"
                          onClick={() => startEdit(row)}
                          className="cursor-pointer flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Remove tag"
                          onClick={() => {
                            if (isTarget) setTargetTag(null)
                            deleteRow(row)
                          }}
                          className="cursor-pointerflex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Outside the table branches on purpose: a filter that empties the page
          would otherwise hide the only control that can page back. */}
      {paginationBar}

      <SourcePickerSheet
        open={sourcePickerOpen}
        onOpenChange={setSourcePickerOpen}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {visibleSelectedCount} tag
              {visibleSelectedCount === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected tag
              {visibleSelectedCount === 1 ? '' : 's'} on this page from the
              dataset. You can add {visibleSelectedCount === 1 ? 'it' : 'them'}{' '}
              back later. This action can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
