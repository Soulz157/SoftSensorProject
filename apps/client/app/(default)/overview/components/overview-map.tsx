'use client'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, ZoomIn, ZoomOut, RotateCcw, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  calculateIsometricLayout,
  computeLayoutBoundingBox,
} from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { PlantTower } from './overview-tower'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'
import {
  type NodeStatus,
  STATUS_META,
  deriveStatus,
  countNodesByStatus,
  deriveSystemStatus,
} from '@/lib/overview-status'
import { useMapViewport } from '@/hooks/canvas/use-map-viewport'

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
}

export function PlantsMap({
  workspaces,
  nodesByWorkspace,
  selectedWorkspaceId,
  onWorkspaceClick,
  onWorkspaceDoubleClick,
  highlightedIds,
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
    totalWarnings,
    // hasOffline,
    overallStatus,
    overallColor,
  } = useMemo(() => deriveSystemStatus(nodesByWorkspace), [nodesByWorkspace])

  // Status hues are vivid for dots but fail WCAG AA as text on the light HUD.
  // Use darker variants for label text in light mode; vivid in dark.
  const STATUS_TEXT_LIGHT: Record<NodeStatus, string> = {
    alarm: '#dc2626',
    warning: '#b45309',
    offline: '#52525b',
    normal: '#15803d',
  }
  const overallTextColor = isDark
    ? overallColor
    : STATUS_TEXT_LIGHT[overallStatus]
  const alarmText = isDark ? '#f87171' : '#dc2626'
  const warningText = isDark ? '#fbbf24' : '#b45309'

  // Hover tooltip data
  const hoveredWs = hoveredId ? workspaces.find(w => w.id === hoveredId) : null
  const hoveredNodes = useMemo(
    () => (hoveredId ? (nodesByWorkspace[hoveredId] ?? []) : []),
    [hoveredId, nodesByWorkspace],
  )
  const hoveredCounts = useMemo(
    () => countNodesByStatus(hoveredNodes),
    [hoveredNodes],
  )

  // Track container size in state — refs must not be read during render
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

  // Tooltip position — clamp to stay inside container
  const TOOLTIP_W = 210
  const TOOLTIP_H = 230
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
              {overallStatus.toUpperCase()}
            </span>
          </div>
          <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-green-400' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold"
              style={{ color: isDark ? '#fff' : '#111' }}
            >
              {workspaces.length}
            </span>{' '}
            Plants Online
          </div>
          <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-red-400' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold"
              style={{
                color: totalAlarms > 0 ? alarmText : isDark ? '#fff' : '#111',
              }}
            >
              {totalAlarms}
            </span>{' '}
            Critical Alerts
          </div>
          <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-amber-400' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold"
              style={{
                color:
                  totalWarnings > 0 ? warningText : isDark ? '#fff' : '#111',
              }}
            >
              {totalWarnings}
            </span>{' '}
            Warnings
          </div>
          {/* <div
            className={cn(
              'text-[13px]',
              isDark ? 'text-white/60' : 'text-muted-foreground',
            )}
          >
            <span
              className="font-semibold"
              style={{
                color: hasOffline ? '#71717a' : isDark ? '#fff' : '#111',
              }}
            >
              {hasOffline ? 'Yes' : 'No'}
            </span>{' '}
            Offline Plants
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

      {/* Hover status tooltip */}
      {hoveredWs && hoverPos && !isDragging && (
        <div
          className="pointer-events-none absolute z-20 shadow-xl backdrop-blur-md"
          style={{ width: TOOLTIP_W, ...tooltipStyle }}
        >
          <Card
            className={cn(
              'overflow-hidden border',
              isDark
                ? 'bg-black/80 border-white/12 text-white'
                : 'bg-white/95 border-black/10 text-foreground',
            )}
          >
            <CardContent className="p-0">
              {/* Thumbnail */}
              {hoveredWs.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${process.env.NEXT_PUBLIC_API_URL}${hoveredWs.thumbnailUrl}`}
                  alt={hoveredWs.name}
                  className="h-24 w-full object-cover"
                />
              ) : (
                <div
                  className={cn(
                    'flex h-16 w-full items-center justify-center',
                    isDark ? 'bg-white/5' : 'bg-muted/40',
                  )}
                >
                  <Building2 className="h-5 w-5 text-muted-foreground/40" />
                </div>
              )}

              {/* Body */}
              <div className="px-3 py-2.5">
                <p className="mb-2.5 truncate text-[11px] font-semibold leading-tight">
                  {hoveredWs.name}
                </p>

                {/* Status count rows */}
                <div className="space-y-1.5">
                  {(
                    Object.entries(STATUS_META) as [
                      NodeStatus,
                      { label: string; color: string },
                    ][]
                  ).map(([key, meta]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span
                        className={cn(
                          'flex-1 text-[10px]',
                          isDark ? 'text-white/55' : 'text-muted-foreground',
                        )}
                      >
                        {meta.label}
                      </span>
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 text-[9px] font-semibold tabular-nums"
                        style={{
                          borderColor: `${meta.color}50`,
                          color: meta.color,
                        }}
                      >
                        {hoveredCounts[key]}
                      </Badge>
                    </div>
                  ))}
                </div>

                <Separator className="my-2 opacity-20" />
                <p
                  className={cn(
                    'text-[10px]',
                    isDark ? 'text-white/35' : 'text-muted-foreground',
                  )}
                >
                  {hoveredNodes.length} node
                  {hoveredNodes.length === 1 ? '' : 's'} · double-click to open
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="application"
        aria-label={`Workspaces overview map — ${workspaces.length} plant${workspaces.length === 1 ? '' : 's'}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ background: palette.bg, touchAction: 'none' }}
        {...svgHandlers}
      >
        <g transform={groupTransform}>
          {layoutData.map(({ zone, floorPath, labelX, labelY }) => {
            const ws = workspaces.find(w => w.id === zone.id)
            if (!ws) return null
            const nodes = nodesByWorkspace[ws.id] ?? []
            const status =
              (ws.status as NodeStatus | undefined) ?? deriveStatus(nodes)
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
                  nodeStatuses={nodes.map(n => n.data.status as NodeStatus)}
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
