'use client'

// TEMPORARY design preview (workspaces redesign, Phase A). Mock data only —
// no real workspace names. Delete once a direction is chosen.

import { useMemo, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Activity } from 'lucide-react'
import {
  filterWorkspaces,
  sortForAttention,
  summarizeWorkspaces,
  type StatusFilter,
  type WorkspaceListItem,
} from '@/lib/workspace-list'
import { WorkspacesHeader } from '@/app/(default)/workspaces/components/workspaces-header'
import { WorkspacesToolbar } from '@/app/(default)/workspaces/components/workspaces-toolbar'
import {
  WorkspaceRow,
  WorkspaceRowHeader,
  WorkspaceRowSkeleton,
} from '@/app/(default)/workspaces/components/workspace-row'
import {
  WorkspaceTile,
  WorkspaceTileSkeleton,
} from '@/app/(default)/workspaces/components/workspace-tile'
import { cn } from '@/lib/utils'

const ICONS = ['building', 'box', 'cpu', 'gauge', 'thermometer', 'activity']
const COLORS = ['blue', 'violet', 'emerald', 'amber', 'rose', 'cyan']

const BASE: WorkspaceListItem[] = [
  {
    id: 'd1',
    name: 'Demo Unit A',
    description: 'Mock workspace for the preview',
    status: 'alarm',
    abnormalModels: 2,
    modelsCount: 12,
    plantsCount: 3,
    datasetsCount: 8,
    updatedAt: '2026-10-07T06:00:00.000Z',
  },
  {
    id: 'd2',
    name: 'Demo Unit B',
    description: 'Another mock workspace',
    status: 'normal',
    abnormalModels: 0,
    modelsCount: 9,
    plantsCount: 2,
    datasetsCount: 5,
    updatedAt: '2026-10-06T06:00:00.000Z',
  },
  {
    id: 'd3',
    name: 'Sample Line 3',
    description: 'No description needed here',
    status: 'normal',
    abnormalModels: 1,
    modelsCount: 4,
    plantsCount: 1,
    datasetsCount: 3,
    updatedAt: '2026-10-05T06:00:00.000Z',
  },
  {
    id: 'd4',
    name: 'Example Site',
    status: 'normal',
    abnormalModels: 0,
    modelsCount: 0,
    plantsCount: 0,
    datasetsCount: 0,
    updatedAt: '2026-09-20T06:00:00.000Z',
  },
  {
    id: 'd6',
    name: 'Placeholder Plant With A Very Long Name That Must Truncate Cleanly',
    description:
      'A long description that must also truncate cleanly without breaking the row layout',
    status: 'normal',
    abnormalModels: 0,
    modelsCount: 21,
    plantsCount: 6,
    datasetsCount: 14,
    updatedAt: '2026-08-30T06:00:00.000Z',
  },
].map((w, i) => ({
  ...w,
  icon: ICONS[i % ICONS.length],
  color: COLORS[i % COLORS.length],
})) as WorkspaceListItem[]

const UNKNOWN: WorkspaceListItem[] = [
  ...BASE.slice(0, 2),
  {
    id: 'd5',
    name: 'Test Bench',
    description: 'Counts not supplied yet',
    status: 'normal',
    abnormalModels: 0,
    modelsCount: null,
    plantsCount: null,
    datasetsCount: undefined,
    updatedAt: '2026-09-12T06:00:00.000Z',
    icon: 'thermometer',
    color: 'rose',
  },
]

const MANY: WorkspaceListItem[] = Array.from({ length: 50 }, (_, i) => ({
  ...BASE[i % BASE.length]!,
  id: `m${i}`,
  name: `Mock Workspace ${String(i + 1).padStart(2, '0')}`,
  abnormalModels: i % 9 === 0 ? 1 : 0,
}))

type Dir = 'list' | 'tiles'
type Data = 'populated' | 'one' | 'many' | 'unknown' | 'loading' | 'empty'

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-md bg-muted p-0.5">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-2 py-1 text-xs whitespace-nowrap transition-colors',
            value === o.id
              ? 'bg-background font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function WorkspacesDesignPreview() {
  const [dir, setDir] = useState<Dir>('list')
  const [data, setData] = useState<Data>('populated')
  const [attentionFirst, setAttentionFirst] = useState<'on' | 'off'>('on')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const source = useMemo<WorkspaceListItem[]>(() => {
    if (data === 'unknown') return UNKNOWN
    if (data === 'one') return BASE.slice(0, 1)
    if (data === 'many') return MANY
    if (data === 'empty' || data === 'loading') return []
    return BASE
  }, [data])
  const summary = useMemo(() => summarizeWorkspaces(source), [source])
  const visible = useMemo(() => {
    const filtered = filterWorkspaces(source, { query, status })
    return attentionFirst === 'on' ? sortForAttention(filtered) : filtered
  }, [source, query, status, attentionFirst])
  const loading = data === 'loading'

  return (
    <>
      <div className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg bg-popover p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.08)] ring-1 ring-foreground/10 dark:shadow-[0_4px_24px_rgba(0,0,0,0.32)]">
        <Seg
          value={dir}
          options={[
            { id: 'list', label: 'A · Instrument list' },
            { id: 'tiles', label: 'B · Refined cards' },
          ]}
          onChange={setDir}
        />
        <Seg
          value={data}
          options={[
            { id: 'populated', label: '5' },
            { id: 'one', label: '1' },
            { id: 'many', label: '50' },
            { id: 'unknown', label: 'Unknown counts' },
            { id: 'loading', label: 'Loading' },
            { id: 'empty', label: 'Empty' },
          ]}
          onChange={setData}
        />
        <Seg
          value={attentionFirst}
          options={[
            { id: 'on', label: 'Attention first' },
            { id: 'off', label: 'Original order' },
          ]}
          onChange={setAttentionFirst}
        />
        {mounted && (
          <Seg
            value={resolvedTheme === 'light' ? 'light' : 'dark'}
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ]}
            onChange={setTheme}
          />
        )}
      </div>

      <div className="min-h-svh bg-background p-6 pb-24 md:p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <WorkspacesHeader summary={summary} onCreate={() => {}} />
          <WorkspacesToolbar
            query={query}
            onQuery={setQuery}
            status={status}
            onStatus={setStatus}
            counts={{
              all: summary.total,
              attention: summary.attention,
              normal: summary.normal,
            }}
          />
          {loading ? (
            dir === 'list' ? (
              <ul
                role="list"
                aria-busy
                className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
              >
                {Array.from({ length: 4 }, (_, i) => (
                  <WorkspaceRowSkeleton key={i} />
                ))}
              </ul>
            ) : (
              <ul role="list" className="grid gap-4 lg:grid-cols-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <WorkspaceTileSkeleton key={i} />
                ))}
              </ul>
            )
          ) : source.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Activity className="size-8 text-muted-foreground" aria-hidden />
              <p className="text-base font-medium">No workspaces yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create a workspace to group your plants, datasets and models.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No workspace matches your search. Clear it or change the filter.
            </div>
          ) : dir === 'list' ? (
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <WorkspaceRowHeader />
              <ul role="list">
                {visible.map(w => (
                  <WorkspaceRow key={w.id} ws={w} />
                ))}
              </ul>
            </div>
          ) : (
            <ul role="list" className="grid gap-4 lg:grid-cols-2">
              {visible.map(w => (
                <WorkspaceTile key={w.id} ws={w} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
