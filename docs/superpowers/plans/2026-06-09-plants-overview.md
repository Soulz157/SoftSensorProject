# Plants Overview Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/plants` page that renders every workspace as a single isometric tower on a 2.5D SVG canvas, replaces Dashboard in the sidebar, and shows an alarm/warning detail panel when a tower is clicked.

**Architecture:** New `use-plants-data` hook mirrors `use-dashboard-data` (workspacesAtom + parallel `getNodes`). A new `PlantsMap` SVG component reuses `calculateIsometricLayout` from `lib/isomatric.ts` for zone positioning but renders `PlantTower` (one SVG tower per workspace) instead of individual `MachineNode` components. `PlantDetailPanel` mirrors `NodeDetailPanel` structure for workspace-level inspection.

**Tech Stack:** Next.js 15 App Router, React, Jotai, Tailwind v4, Lucide React, `lib/isomatric.ts` (`calculateIsometricLayout`, `ZoneItem`), `services/canvas.ts` (`getNodes`, `CanvasNode`), shadcn/ui (`Badge`, `Button`, `Separator`, `Skeleton`).

---

## File Map

| File                                                                 | Action | Responsibility                                 |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `apps/client/hooks/use-plants-data.ts`                               | Create | Fetch all workspace nodes in parallel          |
| `apps/client/app/(default)/plants/components/plant-tower.tsx`        | Create | SVG isometric tower for one workspace          |
| `apps/client/app/(default)/plants/components/plants-map.tsx`         | Create | Full SVG canvas — zones + towers + drag-to-pan |
| `apps/client/app/(default)/plants/components/plant-detail-panel.tsx` | Create | Right inspector: stats + alarm/warning lists   |
| `apps/client/app/(default)/plants/page.tsx`                          | Create | Page shell — wires hook → map → panel          |
| `apps/client/app/(default)/plants/loading.tsx`                       | Create | Skeleton loading state                         |
| `apps/client/app/(default)/plants/error.tsx`                         | Create | Error boundary                                 |
| `apps/client/components/sidebar.tsx`                                 | Modify | Swap `dashboard` item → `plants`               |

---

## Task 1: Hook — `use-plants-data.ts`

**Files:**

- Create: `apps/client/hooks/use-plants-data.ts`

- [ ] **Step 1.1: Write the failing test**

Create `apps/client/hooks/__tests__/use-plants-data.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlantsData } from '../use-plants-data'

vi.mock('@/services/canvas', () => ({
  getNodes: vi.fn(),
}))

vi.mock('jotai', () => ({
  useAtomValue: vi.fn(),
}))

vi.mock('@/store/workspace', () => ({
  workspacesAtom: Symbol('workspacesAtom'),
}))

import { getNodes } from '@/services/canvas'
import { useAtomValue } from 'jotai'

const mockWorkspaces = [
  {
    id: 'ws-1',
    name: 'Plant A',
    color: 'blue',
    icon: 'building',
    nodeCount: 5,
    alarmCount: 1,
    status: 'alarm',
  },
  {
    id: 'ws-2',
    name: 'Plant B',
    color: 'emerald',
    icon: 'cpu',
    nodeCount: 3,
    alarmCount: 0,
    status: 'normal',
  },
]

const mockNodes = [
  {
    id: 'n-1',
    workspaceId: 'ws-1',
    planId: 'p-1',
    data: { name: 'CNC #1', type: 'machine', status: 'alarm', x: 0, y: 0 },
    models: [],
    createdAt: '',
    updatedAt: '2026-06-09T10:00:00Z',
  },
  {
    id: 'n-2',
    workspaceId: 'ws-2',
    planId: 'p-2',
    data: { name: 'Sensor #1', type: 'sensor', status: 'normal', x: 0, y: 0 },
    models: [],
    createdAt: '',
    updatedAt: '2026-06-09T10:00:00Z',
  },
]

describe('usePlantsData', () => {
  beforeEach(() => {
    vi.mocked(useAtomValue).mockReturnValue(mockWorkspaces)
    vi.mocked(getNodes)
      .mockResolvedValueOnce([mockNodes[0]])
      .mockResolvedValueOnce([mockNodes[1]])
  })

  it('returns loading=true initially', () => {
    const { result } = renderHook(() => usePlantsData())
    expect(result.current.loading).toBe(true)
  })

  it('returns all workspaces and nodes after fetch', async () => {
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.workspaces).toHaveLength(2)
    expect(result.current.nodesByWorkspace['ws-1']).toHaveLength(1)
    expect(result.current.nodesByWorkspace['ws-2']).toHaveLength(1)
  })

  it('returns empty nodesByWorkspace when no workspaces', async () => {
    vi.mocked(useAtomValue).mockReturnValue([])
    const { result } = renderHook(() => usePlantsData())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nodesByWorkspace).toEqual({})
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
pnpm --filter client test -- --testPathPatterns=use-plants-data
```

Expected: FAIL — `Cannot find module '../use-plants-data'`

- [ ] **Step 1.3: Implement the hook**

Create `apps/client/hooks/use-plants-data.ts`:

```typescript
'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface PlantsData {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
  loading: boolean
  error: string | null
}

export function usePlantsData(): PlantsData {
  const workspaces = useAtomValue(workspacesAtom)
  const [nodesByWorkspace, setNodesByWorkspace] = useState<
    Record<string, CanvasNode[]>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workspaces.length === 0) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all(workspaces.map(ws => getNodes(ws.id)))
      .then(results => {
        if (cancelled) return
        const map: Record<string, CanvasNode[]> = {}
        workspaces.forEach((ws, i) => {
          map[ws.id] = results[i] ?? []
        })
        setNodesByWorkspace(map)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load equipment data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaces])

  return { workspaces, nodesByWorkspace, loading, error }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
pnpm --filter client test -- --testPathPatterns=use-plants-data
```

Expected: PASS — 3 tests

- [ ] **Step 1.5: Commit**

```bash
git add apps/client/hooks/use-plants-data.ts apps/client/hooks/__tests__/use-plants-data.test.ts
git commit -m "feat(plants): add usePlantsData hook"
```

---

## Task 2: `PlantTower` SVG component

**Files:**

- Create: `apps/client/app/(default)/plants/components/plant-tower.tsx`

- [ ] **Step 2.1: Create the component**

```typescript
'use client'
import { cn } from '@/lib/utils'

type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

const STATUS_COLORS: Record<NodeStatus, string> = {
  normal: '#22c55e',
  warning: '#f59e0b',
  alarm: '#ef4444',
  offline: '#71717a',
}

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

interface PlantTowerProps {
  cx: number
  cy: number
  nodeCount: number
  status: NodeStatus
  workspaceColor: string
  name: string
  selected: boolean
  isDark: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onClick: () => void
  onDoubleClick: () => void
}

export function PlantTower({
  cx,
  cy,
  nodeCount,
  status,
  workspaceColor,
  name,
  selected,
  isDark,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onDoubleClick,
}: PlantTowerProps) {
  const accentHex = COLOR_HEX[workspaceColor] ?? '#3b82f6'
  const statusColor = STATUS_COLORS[status]
  const towerH = Math.max(40, Math.min(20 + nodeCount * 3, 100))
  const tw = 22  // half-width of tower

  // Isometric tower faces — origin at (cx, cy)
  // Top face (diamond) centered at (cx, cy - towerH)
  const topFacePoints = [
    `${cx},${cy - towerH - tw * 0.5}`,       // top
    `${cx + tw},${cy - towerH}`,              // right
    `${cx},${cy - towerH + tw * 0.5}`,        // bottom
    `${cx - tw},${cy - towerH}`,              // left
  ].join(' ')

  // Left face
  const leftFacePoints = [
    `${cx - tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx - tw},${cy}`,
  ].join(' ')

  // Right face
  const rightFacePoints = [
    `${cx + tw},${cy - towerH}`,
    `${cx},${cy - towerH + tw * 0.5}`,
    `${cx},${cy + tw * 0.5}`,
    `${cx + tw},${cy}`,
  ].join(' ')

  // Window positions (left face)
  const windowRows = Math.min(Math.floor(towerH / 18), 4)
  const windows: { x: number; y: number }[] = []
  for (let row = 0; row < windowRows; row++) {
    const wy = cy - towerH + tw * 0.5 + 10 + row * 18
    windows.push({ x: cx - tw + 8, y: wy })
    windows.push({ x: cx - tw + 16, y: wy })
  }

  // Antenna
  const antennaBase = cy - towerH - tw * 0.5
  const antennaTop = antennaBase - 16

  // Selection ring
  const selectionRx = tw + 8
  const selectionRy = 10

  const topFaceColor = status === 'alarm' ? '#ef4444'
    : status === 'warning' ? '#f59e0b'
    : status === 'offline' ? '#52525b'
    : accentHex

  const leftFaceBase = isDark ? 'rgba(15,25,45,0.95)' : 'rgba(200,215,228,0.9)'
  const rightFaceBase = isDark ? 'rgba(8,15,30,0.95)' : 'rgba(180,200,220,0.9)'
  const strokeColor = selected ? accentHex : isDark ? '#1e2535' : '#94a3b8'

  return (
    <g
      className="cursor-pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onDoubleClick={e => { e.preventDefault(); onDoubleClick() }}
    >
      {/* Selection dashed ring */}
      {selected && (
        <ellipse
          cx={cx}
          cy={cy + tw * 0.5}
          rx={selectionRx}
          ry={selectionRy}
          fill="none"
          stroke={accentHex}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.7}
        />
      )}

      {/* Status glow at base */}
      <ellipse cx={cx} cy={cy + tw * 0.5} rx={tw + 4} ry={8} fill={statusColor} opacity={status === 'alarm' ? 0.3 : 0.15} />
      <ellipse cx={cx} cy={cy + tw * 0.5} rx={tw - 4} ry={5} fill={statusColor} opacity={status === 'alarm' ? 0.4 : 0.2} />

      {/* Tower body — right face */}
      <polygon points={rightFacePoints} fill={rightFaceBase} stroke={strokeColor} strokeWidth={0.6} />

      {/* Tower body — left face */}
      <polygon points={leftFacePoints} fill={leftFaceBase} stroke={strokeColor} strokeWidth={0.6} />

      {/* Windows on left face */}
      {windows.map((w, i) => (
        <rect
          key={i}
          x={w.x}
          y={w.y}
          width={5}
          height={7}
          rx={1}
          fill={status === 'alarm' ? '#fca5a5' : status === 'warning' ? '#fcd34d' : '#93c5fd'}
          opacity={0.6 + (i % 2) * 0.2}
        />
      ))}

      {/* Tower top face */}
      <polygon
        points={topFacePoints}
        fill={topFaceColor}
        stroke={status === 'normal' ? '#a5f3fc' : status === 'alarm' ? '#fca5a5' : status === 'warning' ? '#fde68a' : '#d4d4d8'}
        strokeWidth={1.2}
        opacity={status === 'offline' ? 0.6 : 1}
      />

      {/* Antenna */}
      <line
        x1={cx}
        y1={antennaBase}
        x2={cx}
        y2={antennaTop}
        stroke={status === 'offline' ? '#71717a' : accentHex}
        strokeWidth={1.5}
        strokeDasharray={status === 'offline' ? '2 2' : undefined}
      />

      {/* Beacon on antenna tip */}
      {status === 'alarm' && (
        <>
          <circle cx={cx} cy={antennaTop} r={5} fill="#ef4444" opacity={0.9} />
          <circle cx={cx} cy={antennaTop} r={10} fill="none" stroke="#ef4444" strokeWidth={1.5} opacity={0.5} />
          <circle cx={cx} cy={antennaTop} r={16} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.25} />
        </>
      )}
      {status === 'warning' && (
        <>
          <circle cx={cx} cy={antennaTop} r={4} fill="#f59e0b" opacity={0.85} />
          <circle cx={cx} cy={antennaTop} r={8} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={0.4} />
        </>
      )}
      {(status === 'normal' || status === 'offline') && (
        <circle cx={cx} cy={antennaTop} r={2.5} fill={status === 'offline' ? '#52525b' : accentHex} />
      )}

      {/* Name label */}
      <rect
        x={cx - 45}
        y={cy + tw * 0.5 + 10}
        width={90}
        height={16}
        rx={3}
        fill={isDark ? 'rgba(10,13,20,0.92)' : 'rgba(240,244,248,0.92)'}
        stroke={strokeColor}
        strokeWidth={0.6}
      />
      <text
        x={cx}
        y={cy + tw * 0.5 + 22}
        textAnchor="middle"
        fontSize={8}
        fontFamily="monospace"
        fontWeight={600}
        fill={isDark ? (status === 'alarm' ? '#fca5a5' : status === 'warning' ? '#fcd34d' : '#93c5fd') : '#1e293b'}
      >
        {name.length > 14 ? `${name.slice(0, 14)}…` : name}
      </text>
    </g>
  )
}
```

- [ ] **Step 2.2: Commit**

```bash
git add apps/client/app/(default)/plants/components/plant-tower.tsx
git commit -m "feat(plants): add PlantTower SVG component"
```

---

## Task 3: `PlantsMap` SVG canvas component

**Files:**

- Create: `apps/client/app/(default)/plants/components/plants-map.tsx`

- [ ] **Step 3.1: Create the component**

```typescript
'use client'
import { useMemo, useState, useRef } from 'react'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { calculateIsometricLayout } from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import { PlantTower } from './plant-tower'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

const FLOOR_EDGE_LAYERS = 10

const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

function deriveStatus(nodes: CanvasNode[]): NodeStatus {
  if (nodes.some(n => n.data.status === 'alarm')) return 'alarm'
  if (nodes.some(n => n.data.status === 'offline')) return 'offline'
  if (nodes.some(n => n.data.status === 'warning')) return 'warning'
  return 'normal'
}

interface PlantsMapProps {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
  selectedWorkspaceId: string | null
  onWorkspaceClick: (id: string) => void
  onWorkspaceDoubleClick: (id: string) => void
}

export function PlantsMap({
  workspaces,
  nodesByWorkspace,
  selectedWorkspaceId,
  onWorkspaceClick,
  onWorkspaceDoubleClick,
}: PlantsMapProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }
  const handleMouseUp = () => setIsDragging(false)

  const zones: ZoneItem[] = useMemo(
    () => workspaces.map(ws => ({ id: ws.id, name: ws.name, color: ws.color })),
    [workspaces],
  )

  // Pass empty node map — layout only needs zone dimensions (MIN_ZONE_SIZE used when no nodes)
  const layoutData = useMemo(() => {
    const emptyMap = new Map<string, CanvasNode[]>()
    return calculateIsometricLayout(zones, emptyMap, CX, CY)
  }, [zones])

  const palette = isDark
    ? {
        bg: 'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)',
        topFill: 'rgba(20,28,45,0.85)',
        edgeFill: '#0f172a',
        stroke: '#1e2230',
        gridLine: 'rgba(30,37,53,0.5)',
      }
    : {
        bg: 'radial-gradient(ellipse at 50% 40%, #f0f4f8 0%, #dce8f0 80%)',
        topFill: 'rgba(200,215,228,0.70)',
        edgeFill: '#cbd5e1',
        stroke: '#475569',
        gridLine: 'rgba(100,116,139,0.3)',
      }

  // System-wide counts for HUD
  const allNodes = Object.values(nodesByWorkspace).flat()
  const totalAlarms = allNodes.filter(n => n.data.status === 'alarm').length
  const totalWarnings = allNodes.filter(n => n.data.status === 'warning').length
  const overallStatus: NodeStatus = totalAlarms > 0 ? 'alarm' : totalWarnings > 0 ? 'warning' : 'normal'
  const overallColor = overallStatus === 'alarm' ? '#ef4444' : overallStatus === 'warning' ? '#f59e0b' : '#22c55e'

  return (
    <div className="relative h-full w-full">
      {/* HUD overlay */}
      <div className={cn(
        'absolute top-3 left-3 z-10 rounded-xl border px-3 py-2.5 backdrop-blur-sm',
        isDark ? 'bg-black/40 border-white/10 text-white' : 'bg-white/80 border-black/10 text-gray-900',
      )}>
        <div className="mb-2 text-[9px] font-bold uppercase tracking-widest opacity-60">System Status</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: overallColor }} />
            <span className="text-[11px] font-semibold" style={{ color: overallColor }}>
              {overallStatus.toUpperCase()}
            </span>
          </div>
          <div className={cn('text-[11px]', isDark ? 'text-white/60' : 'text-gray-600')}>
            <span className="font-semibold" style={{ color: isDark ? '#fff' : '#111' }}>{workspaces.length}</span>{' '}Plants Online
          </div>
          <div className={cn('text-[11px]', isDark ? 'text-white/60' : 'text-gray-600')}>
            <span className="font-semibold" style={{ color: totalAlarms > 0 ? '#ef4444' : isDark ? '#fff' : '#111' }}>
              {totalAlarms}
            </span>{' '}Critical Alerts
          </div>
        </div>
      </div>

      {/* Theme toggle */}
      <div className="absolute top-3 right-3 z-10 flex items-center rounded-full bg-black/30 p-0.5 backdrop-blur-sm">
        <button
          onClick={() => setIsDark(false)}
          className={cn('flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
            !isDark ? 'bg-white/90 text-gray-900 shadow-sm' : 'text-white/60 hover:text-white/90')}
        >
          <Sun className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setIsDark(true)}
          className={cn('flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
            isDark ? 'bg-white/20 text-white shadow-sm' : 'text-white/60 hover:text-white/90')}
        >
          <Moon className="h-3.5 w-3.5" />
        </button>
      </div>

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ background: palette.bg }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${pan.x},${pan.y})`}>
          {layoutData.map(({ zone, floorPath, labelX, labelY }) => {
            const ws = workspaces.find(w => w.id === zone.id)
            if (!ws) return null
            const nodes = nodesByWorkspace[ws.id] ?? []
            const status = (ws.status as NodeStatus | undefined) ?? deriveStatus(nodes)
            const accentHex = COLOR_HEX[ws.color ?? 'blue'] ?? '#3b82f6'
            const isSelected = selectedWorkspaceId === ws.id
            const isHovered = hoveredId === ws.id

            const edgeFill = isSelected || isHovered ? `${accentHex}60` : palette.edgeFill
            const topFill = isSelected ? `${accentHex}35` : isHovered ? `${accentHex}20` : palette.topFill
            const strokeColor = isSelected || isHovered ? accentHex : palette.stroke

            return (
              <g key={ws.id}>
                {/* Floor depth layers */}
                {Array.from({ length: FLOOR_EDGE_LAYERS }).map((_, i) => (
                  <path
                    key={`edge-${i}`}
                    d={floorPath}
                    fill={edgeFill}
                    stroke={edgeFill}
                    strokeWidth={0.5}
                    transform={`translate(0,${i + 1})`}
                  />
                ))}

                {/* Floor top face */}
                <path
                  d={floorPath}
                  fill={topFill}
                  stroke={strokeColor}
                  strokeWidth={isSelected || isHovered ? 2 : 1.2}
                  strokeDasharray={isSelected ? undefined : '8,5'}
                />

                {/* Tower */}
                <PlantTower
                  cx={labelX}
                  cy={labelY - 30}
                  nodeCount={ws.nodeCount ?? nodes.length}
                  status={status}
                  workspaceColor={ws.color ?? 'blue'}
                  name={ws.name}
                  selected={isSelected}
                  isDark={isDark}
                  onMouseEnter={() => !isDragging && setHoveredId(ws.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => !isDragging && onWorkspaceClick(ws.id)}
                  onDoubleClick={() => !isDragging && onWorkspaceDoubleClick(ws.id)}
                />
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/client/app/(default)/plants/components/plants-map.tsx
git commit -m "feat(plants): add PlantsMap SVG canvas component"
```

---

## Task 4: `PlantDetailPanel` component

**Files:**

- Create: `apps/client/app/(default)/plants/components/plant-detail-panel.tsx`

- [ ] **Step 4.1: Create the component**

```typescript
'use client'
import Link from 'next/link'
import { AlertTriangle, Cpu, Factory, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

const STATUS_CHIP: Record<NodeStatus, string> = {
  normal: 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-500',
  warning: 'border border-amber-500/30 bg-amber-500/15 text-amber-500',
  alarm: 'border border-red-500/30 bg-red-500/15 text-red-500',
  offline: 'border border-zinc-500/30 bg-zinc-500/15 text-zinc-400',
}

const STATUS_DOT: Record<NodeStatus, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  alarm: 'bg-red-500 animate-pulse',
  offline: 'bg-zinc-500',
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function nodeTypeIcon(type: string): string {
  if (type === 'sensor') return '📡'
  if (type === 'controller') return '🎛'
  return '⚙'
}

interface PlantDetailPanelProps {
  workspace: Workspace | null
  nodes: CanvasNode[]
  isOpen: boolean
  onClose: () => void
}

export function PlantDetailPanel({ workspace, nodes, isOpen, onClose }: PlantDetailPanelProps) {
  const panelClass = cn(
    'flex flex-col border-l border-border bg-card/90 backdrop-blur-xl overflow-y-auto',
    'fixed inset-y-0 right-0 z-50 w-80 shadow-2xl transition-transform duration-300',
    'lg:relative lg:inset-auto lg:z-auto lg:w-72 lg:shadow-none lg:shrink-0 lg:translate-x-0',
    isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
  )

  if (!workspace) {
    return (
      <>
        {isOpen && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onClose} />}
        <aside className={cn(panelClass, 'items-center justify-center p-6 text-center')}>
          <Factory className="mb-3 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-foreground">Select a plant</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Click a tower to inspect its equipment and alerts.
          </p>
        </aside>
      </>
    )
  }

  const status = (workspace.status as NodeStatus | undefined) ?? 'normal'
  const alarmNodes = nodes.filter(n => n.data.status === 'alarm')
  const warningNodes = nodes.filter(n => n.data.status === 'warning')
  const alarmCount = alarmNodes.length
  const warningCount = warningNodes.length

  const statusLabel =
    status === 'alarm' ? `Alarm — ${alarmCount} equipment${alarmCount !== 1 ? 's' : ''} critical`
    : status === 'warning' ? `Warning — ${warningCount} equipment${warningCount !== 1 ? 's' : ''}`
    : status === 'offline' ? 'Offline'
    : 'Normal'

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside className={panelClass}>
        {/* Header */}
        <div className="border-b border-border bg-muted/20 px-4 py-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Plant Inspector
          </div>
          <div className="mb-3 flex items-center gap-2">
            <Factory className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-base font-bold text-foreground truncate">{workspace.name}</span>
          </div>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_CHIP[status])}>
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
            {statusLabel}
          </span>
        </div>

        {/* Stats grid */}
        <div className="border-b border-border/50 px-4 py-4">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Equipments</p>
              <p className="text-lg font-bold text-foreground">{workspace.nodeCount ?? nodes.length}</p>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Models</p>
              <p className="text-lg font-bold text-foreground">{workspace.modelsCount ?? 0}</p>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Alarms</p>
              <p className={cn('text-lg font-bold', alarmCount > 0 ? 'text-red-500' : 'text-emerald-500')}>{alarmCount}</p>
            </div>
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Warnings</p>
              <p className={cn('text-lg font-bold', warningCount > 0 ? 'text-amber-500' : 'text-muted-foreground')}>{warningCount}</p>
            </div>
          </div>
        </div>

        {/* Alarm list */}
        {alarmCount > 0 && (
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              Alarms ({alarmCount})
            </div>
            <div className="space-y-2">
              {alarmNodes.map(node => (
                <div key={node.id} className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/6 px-3 py-2.5">
                  <span className="mt-0.5 text-sm">{nodeTypeIcon(node.data.type)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-red-400">{node.data.name}</p>
                    <p className="text-[10px] capitalize text-muted-foreground">{node.data.type}</p>
                    <p className="text-[10px] text-red-500">Status: alarm</p>
                    <p className="text-[10px] text-muted-foreground/60">{formatRelativeTime(node.updatedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning list */}
        {warningCount > 0 && (
          <div className="border-b border-border/50 px-4 py-4">
            <div className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
              <Info className="h-3.5 w-3.5" />
              Warnings ({warningCount})
            </div>
            <div className="space-y-2">
              {warningNodes.map(node => (
                <div key={node.id} className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/6 px-3 py-2.5">
                  <span className="mt-0.5 text-sm">{nodeTypeIcon(node.data.type)}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-amber-400">{node.data.name}</p>
                    <p className="text-[10px] capitalize text-muted-foreground">{node.data.type}</p>
                    <p className="text-[10px] text-amber-500">Status: warning</p>
                    <p className="text-[10px] text-muted-foreground/60">{formatRelativeTime(node.updatedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto space-y-2 px-4 py-4">
          {alarmCount > 0 && (
            <Link
              href="/alerts"
              className="flex w-full items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/8 px-3 py-2 text-center text-xs font-medium text-red-400 transition-colors hover:bg-red-500/15"
            >
              View All Alerts →
            </Link>
          )}
          <Link
            href={`/workspaces/${workspace.id}`}
            className="flex w-full items-center justify-center rounded-md bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            View Workspace →
          </Link>
          <Link
            href={`/workspaces/${workspace.id}/canvas`}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Open Canvas
          </Link>
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 4.2: Commit**

```bash
git add apps/client/app/(default)/plants/components/plant-detail-panel.tsx
git commit -m "feat(plants): add PlantDetailPanel component"
```

---

## Task 5: Page, loading, error

**Files:**

- Create: `apps/client/app/(default)/plants/page.tsx`
- Create: `apps/client/app/(default)/plants/loading.tsx`
- Create: `apps/client/app/(default)/plants/error.tsx`

- [ ] **Step 5.1: Create `loading.tsx`**

```typescript
import { Skeleton } from '@/components/ui/skeleton'

export default function PlantsLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card/70 px-4 py-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Skeleton className="flex-1" />
        <div className="w-72 border-l border-border p-4 space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5.2: Create `error.tsx`**

```typescript
'use client'
import { Button } from '@/components/ui/button'

export default function PlantsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium text-foreground">Failed to load plants</p>
      <p className="text-xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" onClick={reset}>Try again</Button>
    </div>
  )
}
```

- [ ] **Step 5.3: Create `page.tsx`**

```typescript
'use client'
import { useState, useMemo, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { usePlantsData } from '@/hooks/use-plants-data'
import { PlantsMap } from './components/plants-map'
import { PlantDetailPanel } from './components/plant-detail-panel'
import PlantsLoading from './loading'

export default function PlantsPage() {
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  const selectedWorkspace = useMemo(
    () => workspaces.find(ws => ws.id === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId],
  )

  const selectedNodes = useMemo(
    () => (selectedWorkspaceId ? (nodesByWorkspace[selectedWorkspaceId] ?? []) : []),
    [nodesByWorkspace, selectedWorkspaceId],
  )

  useEffect(() => {
    if (selectedWorkspace) setIsPanelOpen(true)
  }, [selectedWorkspace])

  const allNodes = useMemo(() => Object.values(nodesByWorkspace).flat(), [nodesByWorkspace])
  const totalAlarms = allNodes.filter(n => n.data.status === 'alarm').length
  const totalWarnings = allNodes.filter(n => n.data.status === 'warning').length

  const handleWorkspaceClick = (id: string) => {
    setSelectedWorkspaceId(prev => (prev === id ? null : id))
  }

  const handleWorkspaceDoubleClick = (id: string) => {
    window.location.href = `/workspaces/${id}`
  }

  if (loading) return <PlantsLoading />

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">{error}</div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/70 px-4 py-3 backdrop-blur">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Plants Overview</span>
            {totalAlarms > 0 && (
              <span className="inline-flex items-center gap-1 text-red-500">
                <AlertTriangle className="h-3 w-3" />
                {totalAlarms} Alarm
              </span>
            )}
            {totalWarnings > 0 && (
              <span className="text-amber-500">{totalWarnings} Warning</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Click tower to inspect · Double-click to open workspace
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">{workspaces.length} plants</span>
          </span>
          {totalAlarms > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-red-500 font-medium">{totalAlarms} alarm</span>
            </span>
          )}
          {totalWarnings > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">{totalWarnings} warning</span>
            </span>
          )}
        </div>
      </div>

      {/* Canvas + panel */}
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          <PlantsMap
            workspaces={workspaces}
            nodesByWorkspace={nodesByWorkspace}
            selectedWorkspaceId={selectedWorkspaceId}
            onWorkspaceClick={handleWorkspaceClick}
            onWorkspaceDoubleClick={handleWorkspaceDoubleClick}
          />
        </main>
        <PlantDetailPanel
          workspace={selectedWorkspace}
          nodes={selectedNodes}
          isOpen={isPanelOpen}
          onClose={() => setIsPanelOpen(false)}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5.4: Commit**

```bash
git add apps/client/app/(default)/plants/page.tsx apps/client/app/(default)/plants/loading.tsx apps/client/app/(default)/plants/error.tsx
git commit -m "feat(plants): add plants page with loading and error states"
```

---

## Task 6: Sidebar — swap Dashboard → Plants

**Files:**

- Modify: `apps/client/components/sidebar.tsx`

- [ ] **Step 6.1: Read the current file**

```bash
# Read before editing — formatter may have changed whitespace
```

Use the Read tool on `apps/client/components/sidebar.tsx` lines 1-30 to confirm the current import list.

- [ ] **Step 6.2: Add `Factory` to imports, remove `LayoutDashboard`**

Find this import line in `sidebar.tsx`:

```typescript
import {
  LayoutDashboard,
  // ... other icons
} from 'lucide-react'
```

Replace `LayoutDashboard` with `Factory`.

- [ ] **Step 6.3: Replace the dashboard nav item with plants**

Find in `sidebar.tsx`:

```typescript
    {
      id: 'dashboard',
      name: 'Dashboard',
      icon: <LayoutDashboard className="h-4 w-4" />,
      href: '/dashboard',
    },
```

Replace with:

```typescript
    {
      id: 'plants',
      name: 'Plants',
      icon: <Factory className="h-4 w-4" />,
      href: '/plants',
    },
```

- [ ] **Step 6.4: Verify no TypeScript errors**

```bash
pnpm --filter client check-types
```

Expected: 0 errors

- [ ] **Step 6.5: Commit**

```bash
git add apps/client/components/sidebar.tsx
git commit -m "feat(plants): replace Dashboard nav item with Plants"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Run full build**

```bash
pnpm build
```

Expected: All packages build cleanly, 0 TypeScript errors.

- [ ] **Step 7.2: Run client tests**

```bash
pnpm --filter client test
```

Expected: All tests pass including `use-plants-data`.

- [ ] **Step 7.3: Format**

```bash
pnpm format
```

- [ ] **Step 7.4: Final commit**

```bash
git add -p
git commit -m "chore: format plants overview implementation"
```

---

## Verification checklist (manual)

1. Open `http://localhost:3000/plants` — isometric map renders with workspace towers
2. Sidebar shows **Plants** in position 1, no Dashboard entry
3. Each tower status glow + beacon matches worst node status in workspace
4. Click tower → right panel slides in with EQUIPMENTS / MODELS / ALARMS / WARNINGS stats
5. Alarm panel section shows per-equipment list with name, type, relative time
6. "View Workspace →" navigates to `/workspaces/[id]`
7. "Open Canvas" navigates to `/workspaces/[id]/canvas`
8. Double-click tower → navigates to `/workspaces/[id]`
9. Drag canvas → pan works
10. Theme toggle (sun/moon) → light/dark scene switches
