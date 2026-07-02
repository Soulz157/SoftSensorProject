'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  calculateIsometricLayout,
  computeLayoutBoundingBox,
} from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import { PlantTower } from './overview-tower'
import { OverviewHoverCard } from './overview-hover-card'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'
import {
  type NodeStatus,
  type BinaryStatus,
  BINARY_STATUS_META,
  deriveStatus,
  deriveSystemStatus,
} from '@/lib/overview-status'
import { useMapViewport } from '@/hooks/canvas/use-map-viewport'
import { failedDeploys } from '@/lib/model-status'
import { useModels } from '@/hooks/workspace/use-models'

const VIEWPORT_W = 700
const VIEWPORT_H = 420
const CX = VIEWPORT_W / 2
const CY = VIEWPORT_H / 2 - 20

const FLOOR_EDGE_LAYERS = 10

interface PlantsMapProps {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
  selectedWorkspaceId: string | null
  onWorkspaceClick: (id: string) => void
  onWorkspaceDoubleClick: (id: string) => void
  highlightedIds?: Set<string>
  failedDeploysByWorkspace?: Record<string, number>
  failedByNodeId?: Record<string, number>
}

export function PlantsMap({
  workspaces,
  nodesByWorkspace,
  selectedWorkspaceId,
  onWorkspaceClick,
  onWorkspaceDoubleClick,
  highlightedIds,
  failedDeploysByWorkspace,
  failedByNodeId,
}: PlantsMapProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const zones: ZoneItem[] = useMemo(
    () => workspaces.map(ws => ({ id: ws.id, name: ws.name, color: ws.color })),
    [workspaces],
  )

  const layoutData = useMemo(() => {
    const emptyMap = new Map<string, CanvasNode[]>()
    return calculateIsometricLayout(zones, emptyMap, CX, CY)
  }, [zones])

  const vb = useMemo(
    () => computeLayoutBoundingBox(layoutData, 160, 60),
    [layoutData],
  )
  const vbCX = vb.x + vb.w / 2
  const vbCY = vb.y + vb.h / 2

  const {
    isDragging,
    hoveredId,
    setHoveredId,
    hoverPos,
    containerRef,
    svgRef,
    groupTransform,
    handleTowerLeave,
    zoomIn,
    zoomOut,
    resetView,
    svgHandlers,
  } = useMapViewport(vbCX, vbCY)

  const palette = isDark
    ? { bg: 'radial-gradient(ellipse at 50% 40%, #0e1520 0%, #080a0f 80%)' }
    : { bg: 'radial-gradient(ellipse at 50% 40%, #f0f4f8 0%, #dce8f0 80%)' }

  const {
    totalAlarms,
    totalWarnings: nodeWarnings,
    hasOffline,
  } = useMemo(() => deriveSystemStatus(nodesByWorkspace), [nodesByWorkspace])

  const { data: hoveredModelsRaw } = useModels(hoveredId ?? '')
  const hoveredFailedCount = failedDeploys(hoveredModelsRaw ?? []).length

  // const totalFailedDeploys = useMemo(
  //   () =>
  //     Object.values(failedDeploysByWorkspace ?? {}).reduce((s, n) => s + n, 0),
  //   [failedDeploysByWorkspace],
  // )

  const overallBinary: BinaryStatus =
    totalAlarms > 0 || hasOffline || nodeWarnings > 0 ? 'abnormal' : 'normal'
  const overallColor = BINARY_STATUS_META[overallBinary].color
  const overallTextColor = isDark
    ? overallColor
    : overallBinary === 'abnormal'
      ? '#dc2626'
      : '#15803d'
  const totalAbnormal = Object.values(nodesByWorkspace)
    .flat()
    .filter(n => (n.data.status as NodeStatus) !== 'normal').length
  const abnormalText = isDark ? '#f87171' : '#dc2626'
  // const failedText = isDark ? '#fbbf24' : '#b45309'

  const hoveredWs = hoveredId ? workspaces.find(w => w.id === hoveredId) : null
  const hoveredNodes = useMemo(
    () => (hoveredId ? (nodesByWorkspace[hoveredId] ?? []) : []),
    [hoveredId, nodesByWorkspace],
  )

  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () =>
      setContainerSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const TOOLTIP_W = 210
  const TOOLTIP_H = 380
  const tooltipStyle = useMemo(() => {
    if (!hoverPos || !containerSize.w) return { display: 'none' as const }
    const { w: cw, h: ch } = containerSize
    const left =
      hoverPos.x + 16 + TOOLTIP_W > cw
        ? hoverPos.x - TOOLTIP_W - 8
        : hoverPos.x + 16
    const top =
      hoverPos.y + 16 + TOOLTIP_H > ch
        ? hoverPos.y - TOOLTIP_H - 8
        : hoverPos.y + 16
    return { left, top }
  }, [hoverPos, containerSize])

  const zoomBtnCls = cn(
    'flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors',
    isDark
      ? 'bg-black/40 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
      : 'bg-white/80 border border-black/10 text-foreground hover:bg-white',
  )

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* System status HUD */}
      <div
        className={cn(
          'absolute top-17 left-3 z-10 rounded-xl border px-3 py-2.5',
          isDark
            ? 'bg-zinc-900 border-white/10 text-white'
            : 'bg-white border-black/10 text-foreground',
        )}
      >
        <div className="mb-2 px-2 text-[10px] font-medium opacity-60">
          System Status
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: overallColor }}
            />
            <span
              className="text-[11px] font-semibold"
              style={{ color: overallTextColor }}
            >
              {BINARY_STATUS_META[overallBinary].label.toUpperCase()}
            </span>
          </div>
          <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-white/55' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold tabular-nums"
              style={{ color: isDark ? '#fff' : '#111' }}
            >
              {workspaces.length}
            </span>{' '}
            Online
          </div>
          <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-white/55' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  totalAbnormal > 0 ? abnormalText : isDark ? '#fff' : '#111',
              }}
            >
              {totalAbnormal}
            </span>{' '}
            Abnormal
          </div>
          {/* <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-white/55' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  totalFailedDeploys > 0
                    ? failedText
                    : isDark
                      ? '#fff'
                      : '#111',
              }}
            >
              {totalFailedDeploys}
            </span>{' '}
            Model deploys failed
          </div> */}
        </div>
      </div>

      {/* Theme toggle */}
      <div
        role="group"
        aria-label="Map theme"
        className="absolute right-3 top-3 z-10 flex items-center rounded-full bg-black/55 p-0.5"
      >
        <button
          type="button"
          aria-label="Light map"
          aria-pressed={!isDark}
          onClick={() => setTheme('light')}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200',
            !isDark
              ? 'bg-white/90 text-gray-900 shadow-sm'
              : 'text-white/60 hover:text-white/90',
          )}
        >
          <Sun className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Dark map"
          aria-pressed={isDark}
          onClick={() => setTheme('dark')}
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200',
            isDark
              ? 'bg-white/20 text-white shadow-sm'
              : 'text-white/60 hover:text-white/90',
          )}
        >
          <Moon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={zoomIn}
          className={zoomBtnCls}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset zoom and pan"
          onClick={resetView}
          className={zoomBtnCls}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={zoomOut}
          className={zoomBtnCls}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Hover status card */}
      {hoveredWs && hoverPos && !isDragging && (
        <OverviewHoverCard
          workspace={hoveredWs}
          nodes={hoveredNodes}
          models={hoveredModelsRaw ?? []}
          failedCount={hoveredFailedCount}
          isDark={isDark}
          width={TOOLTIP_W}
          style={tooltipStyle}
        />
      )}

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="application"
        aria-label={`Plants overview map — ${workspaces.length} plant${workspaces.length === 1 ? '' : 's'}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ background: palette.bg, touchAction: 'none' }}
        {...svgHandlers}
      >
        <g transform={groupTransform}>
          {layoutData.map(({ zone, floorPath, labelX, labelY }) => {
            const ws = workspaces.find(w => w.id === zone.id)
            if (!ws) return null
            const nodes = nodesByWorkspace[ws.id] ?? []
            const nodeStatus =
              (ws.status as NodeStatus | undefined) ?? deriveStatus(nodes)
            const failedCount = failedDeploysByWorkspace?.[ws.id] ?? 0
            const status: NodeStatus =
              failedCount > 0 &&
              nodeStatus !== 'alarm' &&
              nodeStatus !== 'offline'
                ? 'warning'
                : nodeStatus
            const isSelected = selectedWorkspaceId === ws.id
            const isHovered = hoveredId === ws.id
            const isFiltered =
              highlightedIds !== undefined && !highlightedIds.has(ws.id)

            return (
              <g
                key={ws.id}
                style={{
                  opacity: isFiltered ? 0.12 : 1,
                  transition: 'opacity 0.25s ease',
                  pointerEvents: isFiltered ? 'none' : 'auto',
                }}
              >
                {Array.from({ length: FLOOR_EDGE_LAYERS }).map((_, i) => (
                  <path
                    key={`edge-${i}`}
                    d={floorPath}
                    className={cn(
                      'transition-colors duration-200',
                      'fill-zinc-200 stroke-zinc-300',
                      'dark:fill-zinc-900 dark:stroke-zinc-700',
                      (isSelected || isHovered) &&
                        'fill-zinc-300 dark:fill-zinc-800',
                    )}
                    strokeWidth={0.5}
                    transform={`translate(0,${i + 1})`}
                  />
                ))}

                {/* Floor top face */}
                <path
                  d={floorPath}
                  strokeWidth={isSelected || isHovered ? 2 : 1.2}
                  strokeDasharray={isSelected ? undefined : '8,5'}
                  className={cn(
                    'cursor-pointer transition-colors duration-200',
                    'fill-zinc-100 stroke-zinc-300 hover:fill-zinc-200',
                    'dark:fill-zinc-800 dark:stroke-zinc-600 dark:hover:fill-zinc-700',
                    isSelected &&
                      'fill-zinc-200 stroke-zinc-500 dark:fill-zinc-700 dark:stroke-zinc-400',
                  )}
                  onMouseEnter={() => !isDragging && setHoveredId(ws.id)}
                  onMouseLeave={handleTowerLeave}
                  onClick={() => !isDragging && onWorkspaceClick(ws.id)}
                  onDoubleClick={() =>
                    !isDragging && onWorkspaceDoubleClick(ws.id)
                  }
                />

                {/* Tower */}
                <PlantTower
                  cx={labelX}
                  cy={labelY - 30}
                  nodeCount={ws.nodeCount ?? nodes.length}
                  status={status}
                  nodeStatuses={nodes.map(n => {
                    const base = n.data.status as NodeStatus
                    return (failedByNodeId?.[n.id] ?? 0) > 0 && base !== 'alarm'
                      ? 'warning'
                      : base
                  })}
                  workspaceColor={ws.color ?? 'blue'}
                  name={ws.name}
                  selected={isSelected}
                  isDark={isDark}
                  onMouseEnter={() => !isDragging && setHoveredId(ws.id)}
                  onMouseLeave={handleTowerLeave}
                  onClick={() => !isDragging && onWorkspaceClick(ws.id)}
                  onDoubleClick={() =>
                    !isDragging && onWorkspaceDoubleClick(ws.id)
                  }
                />
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
