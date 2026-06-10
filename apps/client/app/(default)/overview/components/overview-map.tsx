'use client'
import { useMemo, useState, useRef } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { calculateIsometricLayout } from '@/lib/isomatric'
import type { ZoneItem } from '@/lib/isomatric'
import { PlantTower } from './overview-tower'
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
  const { resolvedTheme } = useTheme()
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isDark, setIsDark] = useState(resolvedTheme !== 'light')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragStart = useRef({ x: 0, y: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    })
  }
  const handleMouseUp = () => setIsDragging(false)

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    setIsDragging(true)
    dragStart.current = { x: touch.clientX - pan.x, y: touch.clientY - pan.y }
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const touch = e.touches[0]
    if (!touch) return
    setPan({
      x: touch.clientX - dragStart.current.x,
      y: touch.clientY - dragStart.current.y,
    })
  }
  const handleTouchEnd = () => setIsDragging(false)

  const zones: ZoneItem[] = useMemo(
    () => workspaces.map(ws => ({ id: ws.id, name: ws.name, color: ws.color })),
    [workspaces],
  )

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
      }
    : {
        bg: 'radial-gradient(ellipse at 50% 40%, #f0f4f8 0%, #dce8f0 80%)',
        topFill: 'rgba(200,215,228,0.70)',
        edgeFill: '#cbd5e1',
        stroke: '#475569',
      }

  const allNodes = Object.values(nodesByWorkspace).flat()
  const totalAlarms = allNodes.filter(n => n.data.status === 'alarm').length
  const totalWarnings = allNodes.filter(n => n.data.status === 'warning').length
  const hasOffline = allNodes.some(n => n.data.status === 'offline')
  const overallStatus: NodeStatus =
    totalAlarms > 0
      ? 'alarm'
      : hasOffline
        ? 'offline'
        : totalWarnings > 0
          ? 'warning'
          : 'normal'
  const overallColor =
    overallStatus === 'alarm'
      ? '#ef4444'
      : overallStatus === 'warning'
        ? '#f59e0b'
        : overallStatus === 'offline'
          ? '#71717a'
          : '#22c55e'

  return (
    <div className="relative h-full w-full">
      {/* HUD overlay */}
      <div
        className={cn(
          'absolute top-17 left-3 z-10 rounded-xl border px-3 py-2.5 backdrop-blur-sm',
          isDark
            ? 'bg-black/40 border-white/10 text-white'
            : 'bg-white/80 border-black/10 text-gray-900',
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
              style={{ color: overallColor }}
            >
              {overallStatus.toUpperCase()}
            </span>
          </div>
          <div
            className={cn(
              'text-[11px]',
              isDark ? 'text-white/60' : 'text-gray-600',
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
              'text-[11px]',
              isDark ? 'text-white/60' : 'text-gray-600',
            )}
          >
            <span
              className="font-semibold"
              style={{
                color: totalAlarms > 0 ? '#ef4444' : isDark ? '#fff' : '#111',
              }}
            >
              {totalAlarms}
            </span>{' '}
            Critical Alerts
          </div>
        </div>
      </div>

      {/* Theme toggle */}
      <div className="absolute top-3 right-3 z-10 flex items-center rounded-full bg-black/30 p-0.5 backdrop-blur-sm">
        <button
          onClick={() => setIsDark(false)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
            !isDark
              ? 'bg-white/90 text-gray-900 shadow-sm'
              : 'text-white/60 hover:text-white/90',
          )}
        >
          <Sun className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setIsDark(true)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200',
            isDark
              ? 'bg-white/20 text-white shadow-sm'
              : 'text-white/60 hover:text-white/90',
          )}
        >
          <Moon className="h-3.5 w-3.5" />
        </button>
      </div>

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VIEWPORT_W} ${VIEWPORT_H}`}
        className={`h-full w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ background: palette.bg, touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <g transform={`translate(${pan.x},${pan.y})`}>
          {layoutData.map(({ zone, floorPath, labelX, labelY }) => {
            const ws = workspaces.find(w => w.id === zone.id)
            if (!ws) return null
            const nodes = nodesByWorkspace[ws.id] ?? []
            const status =
              (ws.status as NodeStatus | undefined) ?? deriveStatus(nodes)
            const accentHex = COLOR_HEX[ws.color ?? 'blue'] ?? '#3b82f6'
            const isSelected = selectedWorkspaceId === ws.id
            const isHovered = hoveredId === ws.id

            const edgeFill =
              isSelected || isHovered ? `${accentHex}60` : palette.edgeFill
            const topFill = isSelected
              ? `${accentHex}35`
              : isHovered
                ? `${accentHex}20`
                : palette.topFill
            const strokeColor =
              isSelected || isHovered ? accentHex : palette.stroke

            return (
              <g key={ws.id}>
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

                {/* Floor top face (เพิ่ม Event ต่างๆ ตรงนี้) */}
                <path
                  d={floorPath}
                  fill={topFill}
                  stroke={strokeColor}
                  strokeWidth={isSelected || isHovered ? 2 : 1.2}
                  strokeDasharray={isSelected ? undefined : '8,5'}
                  className="cursor-pointer"
                  onMouseEnter={() => !isDragging && setHoveredId(ws.id)}
                  onMouseLeave={() => setHoveredId(null)}
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
                  workspaceColor={ws.color ?? 'blue'}
                  name={ws.name}
                  selected={isSelected}
                  isDark={isDark}
                  onMouseEnter={() => !isDragging && setHoveredId(ws.id)}
                  onMouseLeave={() => setHoveredId(null)}
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
